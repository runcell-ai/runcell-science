import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import readline from 'node:readline'

export interface CodexJsonRpcMessage {
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

export interface CodexJsonRpcClientOptions {
  binaryPath: string
  env?: NodeJS.ProcessEnv
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export class CodexJsonRpcClient extends EventEmitter {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly pendingRequests = new Map<number, PendingRequest>()
  private nextRequestId = 1
  private disposed = false

  constructor(options: CodexJsonRpcClientOptions) {
    super()
    this.child = spawn(options.binaryPath, ['app-server'], {
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    const stdout = readline.createInterface({ input: this.child.stdout })
    stdout.on('line', (line) => this.handleStdoutLine(line))

    const stderr = readline.createInterface({ input: this.child.stderr })
    stderr.on('line', (line) => {
      this.emit('stderr', line)
    })

    this.child.on('error', (error) => {
      this.rejectAll(error)
      this.emit('error', error)
    })

    this.child.on('exit', (code, signal) => {
      const error = new Error(`Codex app-server exited with code ${code ?? 'null'} and signal ${signal ?? 'null'}.`)
      this.rejectAll(error)
      this.emit('exit', { code, signal })
    })
  }

  request<T>(method: string, params: unknown): Promise<T> {
    if (this.disposed) {
      return Promise.reject(new Error('Codex JSON-RPC client is disposed.'))
    }

    const id = this.nextRequestId
    this.nextRequestId += 1

    const message = {
      id,
      method,
      params
    }

    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (value) => resolve(value as T),
        reject
      })
      this.write(message)
    })
  }

  notify(method: string, params: unknown): void {
    this.write({
      method,
      params
    })
  }

  respond(id: number | string, result: unknown): void {
    this.write({
      id,
      result
    })
  }

  respondError(id: number | string, code: number, message: string, data?: unknown): void {
    this.write({
      id,
      error: {
        code,
        message,
        ...(data !== undefined ? { data } : {})
      }
    })
  }

  dispose(): void {
    if (this.disposed) {
      return
    }

    this.disposed = true
    this.rejectAll(new Error('Codex JSON-RPC client disposed.'))
    this.child.kill('SIGTERM')
  }

  private write(message: unknown): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private handleStdoutLine(line: string): void {
    let message: CodexJsonRpcMessage
    try {
      message = JSON.parse(line) as CodexJsonRpcMessage
    } catch (error) {
      this.emit('error', new Error(`Failed to parse Codex app-server JSON line: ${line}`, { cause: error }))
      return
    }

    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const id = Number(message.id)
      const pending = this.pendingRequests.get(id)
      if (!pending) {
        return
      }

      this.pendingRequests.delete(id)
      if (message.error) {
        pending.reject(new Error(message.error.message))
      } else {
        pending.resolve(message.result)
      }
      return
    }

    if (message.id !== undefined && message.method) {
      this.emit('serverRequest', message)
      return
    }

    if (message.method) {
      this.emit('notification', message)
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error)
    }
    this.pendingRequests.clear()
  }
}
