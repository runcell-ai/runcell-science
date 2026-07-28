import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'

import { readBoundedLines } from '../../bounded-line-reader'
import { sanitizeProviderOutput } from '../../provider-output-sanitizer'
import { spawnProviderProcess } from '../../provider-process-launch'
import { ProviderRpcError } from '../../provider-rpc-error'

const MAX_TRANSPORT_MESSAGE_BYTES = 8 * 1024 * 1024
const MAX_TRANSPORT_STDERR_LINE_BYTES = 64 * 1024

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
  /** Extra CLI args inserted before the app-server subcommand (e.g. -c overrides). */
  extraArgs?: string[]
  platform?: NodeJS.Platform
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export class CodexJsonRpcClient extends EventEmitter {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly env: NodeJS.ProcessEnv
  private readonly pendingRequests = new Map<number, PendingRequest>()
  private readonly stderrTail: string[] = []
  private nextRequestId = 1
  private disposed = false
  private transportFailed = false

  constructor(options: CodexJsonRpcClientOptions) {
    super()
    this.env = options.env ?? {}
    this.child = spawnProviderProcess(options.binaryPath, [...(options.extraArgs ?? []), 'app-server'], {
      env: options.env,
      windowsHide: true
    })

    readBoundedLines(
      this.child.stdout,
      MAX_TRANSPORT_MESSAGE_BYTES,
      (line) => this.handleStdoutLine(line),
      () => this.failTransport('Codex app-server response exceeded the transport output limit.')
    )
    readBoundedLines(
      this.child.stderr,
      MAX_TRANSPORT_STDERR_LINE_BYTES,
      (line) => {
        const sanitized = sanitizeProviderOutput(line, this.env, 4_096)
        this.stderrTail.push(sanitized)
        if (this.stderrTail.length > 10) {
          this.stderrTail.shift()
        }
        this.emit('stderr', sanitized)
      },
      () => this.failTransport('Codex app-server stderr exceeded the transport output limit.')
    )

    this.child.on('error', (error) => {
      this.rejectAll(error)
      this.emit('error', error)
    })

    this.child.on('exit', (code, signal) => {
      const stderrSuffix = this.stderrTail.length > 0 ? ` Recent stderr: ${this.stderrTail.join(' | ')}` : ''
      const error = new Error(
        `Codex app-server exited with code ${code ?? 'null'} and signal ${signal ?? 'null'}.${stderrSuffix}`
      )
      this.rejectAll(error)
      this.emit('exit', { code, signal })
    })
  }

  request<T>(method: string, params: unknown, timeoutMs?: number): Promise<T> {
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
      let timer: NodeJS.Timeout | null = null
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          if (this.pendingRequests.delete(id)) {
            reject(new Error(`Codex request ${method} timed out after ${timeoutMs}ms.`))
          }
        }, timeoutMs)
      }

      this.pendingRequests.set(id, {
        resolve: (value) => {
          if (timer) clearTimeout(timer)
          resolve(value as T)
        },
        reject: (error) => {
          if (timer) clearTimeout(timer)
          reject(error)
        }
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
      this.emit('error', new Error('Failed to parse a Codex app-server JSON response.', { cause: error }))
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
        pending.reject(
          new ProviderRpcError(
            sanitizeProviderOutput(message.error.message, this.env),
            message.error.code
          )
        )
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

  private failTransport(message: string): void {
    if (this.transportFailed) {
      return
    }
    this.transportFailed = true
    const error = new Error(message)
    this.rejectAll(error)
    this.child.kill('SIGTERM')
    this.emit('error', error)
  }
}
