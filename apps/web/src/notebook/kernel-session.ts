import type { NotebookRawOutput } from './notebook-doc'

export interface JupyterConnection {
  baseUrl: string
  wsUrl: string
  token: string
}

export type KernelStatus = 'unknown' | 'starting' | 'idle' | 'busy' | 'restarting' | 'dead'
export type ExecuteCellStatus = 'ok' | 'error' | 'abort'

export interface KernelSessionOptions {
  connection: JupyterConnection
  path: string
  onStatusChange?: (status: KernelStatus) => void
  WebSocket?: typeof WebSocket
}

export interface ExecuteCellHandlers {
  onOutput?: (output: NotebookRawOutput) => void
  onClearOutput?: (wait: boolean) => void
  onExecutionCount?: (count: number | null) => void
}

type JupyterServices = typeof import('@jupyterlab/services')
type ServiceSession = {
  id: string
  kernel: ServiceKernel | null
  dispose: () => void
  shutdown: () => Promise<void>
}
type ServiceKernel = {
  id: string
  status: string
  statusChanged: {
    connect: (slot: (_sender: unknown, status: string) => void) => void
    disconnect: (slot: (_sender: unknown, status: string) => void) => void
  }
  requestExecute: (options: { code: string; stop_on_error: boolean }) => ServiceFuture
  interrupt: () => Promise<void>
  restart: () => Promise<void>
}
type ServiceFuture = {
  onIOPub: ((message: unknown) => void) | null
  done: Promise<{ content?: { status?: string } }>
  dispose?: () => void
}
type SessionModel = {
  id: string
  name: string
  path: string
  type: string
  kernel: { id?: string; name?: string } | null
}

let servicesPromise: Promise<JupyterServices> | null = null

function loadServices(): Promise<JupyterServices> {
  servicesPromise ??= import('@jupyterlab/services')
  return servicesPromise
}

function normalizeStatus(status: string): KernelStatus {
  if (
    status === 'starting' ||
    status === 'idle' ||
    status === 'busy' ||
    status === 'restarting' ||
    status === 'dead'
  ) {
    return status
  }
  return 'unknown'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asMimeBundle(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((line): line is string => typeof line === 'string')
  }
  if (typeof value === 'string') {
    return [value]
  }
  return []
}

function contentOf(message: unknown): Record<string, unknown> {
  return isRecord(message) && isRecord(message.content) ? message.content : {}
}

function headerType(message: unknown): string | null {
  if (!isRecord(message) || !isRecord(message.header)) {
    return null
  }
  return typeof message.header.msg_type === 'string' ? message.header.msg_type : null
}

function outputFromMessage(services: JupyterServices, message: unknown): NotebookRawOutput | null {
  const { KernelMessage } = services
  const kernelMessage = message as Parameters<typeof KernelMessage.isStreamMsg>[0]
  const content = contentOf(message)
  if (KernelMessage.isStreamMsg(kernelMessage)) {
    return {
      output_type: 'stream',
      name: typeof content.name === 'string' ? content.name : 'stdout',
      text: typeof content.text === 'string' ? content.text : ''
    }
  }
  if (KernelMessage.isExecuteResultMsg(kernelMessage)) {
    return {
      output_type: 'execute_result',
      execution_count: typeof content.execution_count === 'number' ? content.execution_count : null,
      data: asMimeBundle(content.data),
      metadata: isRecord(content.metadata) ? content.metadata : {}
    }
  }
  if (KernelMessage.isDisplayDataMsg(kernelMessage)) {
    return {
      output_type: 'display_data',
      data: asMimeBundle(content.data),
      metadata: isRecord(content.metadata) ? content.metadata : {}
    }
  }
  if (KernelMessage.isErrorMsg(kernelMessage)) {
    return {
      output_type: 'error',
      ename: typeof content.ename === 'string' ? content.ename : 'Error',
      evalue: typeof content.evalue === 'string' ? content.evalue : '',
      traceback: asStringArray(content.traceback)
    }
  }
  return null
}

async function arrayFromRunning(value: unknown): Promise<SessionModel[]> {
  const resolved = await value
  if (Array.isArray(resolved)) {
    return resolved.filter(isSessionModel)
  }
  const items: SessionModel[] = []
  if (resolved && typeof resolved === 'object' && Symbol.iterator in resolved) {
    for (const item of resolved as Iterable<unknown>) {
      if (isSessionModel(item)) {
        items.push(item)
      }
    }
  }
  return items
}

function isSessionModel(value: unknown): value is SessionModel {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.path === 'string' &&
    'kernel' in value
  )
}

function baseName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

export class KernelSession {
  private readonly services: JupyterServices
  private readonly manager: unknown
  private readonly kernelManager: unknown
  private readonly statusSlot: (_sender: unknown, status: string) => void
  private session: ServiceSession
  private disposed = false

  private constructor(
    services: JupyterServices,
    manager: unknown,
    kernelManager: unknown,
    session: ServiceSession,
    onStatusChange?: (status: KernelStatus) => void
  ) {
    this.services = services
    this.manager = manager
    this.kernelManager = kernelManager
    this.session = session
    this.statusSlot = (_sender, status) => onStatusChange?.(normalizeStatus(status))
    if (this.session.kernel) {
      this.session.kernel.statusChanged.connect(this.statusSlot)
      onStatusChange?.(normalizeStatus(this.session.kernel.status))
    }
  }

  get kernelId(): string | null {
    return this.session.kernel?.id ?? null
  }

  get status(): KernelStatus {
    return normalizeStatus(this.session.kernel?.status ?? 'unknown')
  }

  static async connect(options: KernelSessionOptions): Promise<KernelSession> {
    const services = await loadServices()
    const settingsOptions: Record<string, unknown> = {
      baseUrl: options.connection.baseUrl,
      wsUrl: options.connection.wsUrl,
      token: options.connection.token,
      appendToken: true
    }
    if (options.WebSocket) {
      settingsOptions.WebSocket = options.WebSocket
    }
    const serverSettings = services.ServerConnection.makeSettings(settingsOptions)
    const kernelManager = new services.KernelManager({ serverSettings })
    const manager = new services.SessionManager({ serverSettings, kernelManager })
    await manager.ready
    await manager.refreshRunning()

    const running = await arrayFromRunning(manager.running())
    const existing = running.find((session) => session.path === options.path && session.type === 'notebook')
    const session = existing
      ? manager.connectTo({ model: existing as never })
      : await manager.startNew({
          path: options.path,
          name: baseName(options.path),
          type: 'notebook',
          kernel: { name: 'python3' }
        })

    return new KernelSession(services, manager, kernelManager, session as ServiceSession, options.onStatusChange)
  }

  async executeCell(code: string, handlers: ExecuteCellHandlers = {}): Promise<ExecuteCellStatus> {
    const kernel = this.session.kernel
    if (!kernel) {
      throw new Error('No kernel is attached to this notebook session.')
    }

    const future = kernel.requestExecute({ code, stop_on_error: false })
    future.onIOPub = (message: unknown) => {
      const msgType = headerType(message)
      const content = contentOf(message)
      if (msgType === 'execute_input') {
        handlers.onExecutionCount?.(typeof content.execution_count === 'number' ? content.execution_count : null)
        return
      }
      if (msgType === 'clear_output') {
        handlers.onClearOutput?.(content.wait === true)
        return
      }
      const output = outputFromMessage(this.services, message)
      if (output) {
        handlers.onOutput?.(output)
      }
    }

    try {
      const reply = await future.done
      const status = reply.content?.status
      if (status === 'error' || status === 'abort') {
        return status
      }
      return 'ok'
    } finally {
      future.dispose?.()
    }
  }

  async interrupt(): Promise<void> {
    await this.session.kernel?.interrupt()
  }

  async restart(): Promise<void> {
    await this.session.kernel?.restart()
  }

  async shutdown(): Promise<void> {
    this.disconnectStatus()
    await this.session.shutdown()
    this.disposeManager()
  }

  dispose(): void {
    this.disconnectStatus()
    this.session.dispose()
    this.disposeManager()
    this.disposed = true
  }

  private disconnectStatus(): void {
    if (!this.disposed && this.session.kernel) {
      this.session.kernel.statusChanged.disconnect(this.statusSlot)
    }
  }

  private disposeManager(): void {
    if (isRecord(this.manager) && typeof this.manager.dispose === 'function') {
      this.manager.dispose()
    }
    if (isRecord(this.kernelManager) && typeof this.kernelManager.dispose === 'function') {
      this.kernelManager.dispose()
    }
  }
}
