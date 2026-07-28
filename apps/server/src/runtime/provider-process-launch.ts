import type {
  ChildProcess,
  ChildProcessWithoutNullStreams,
  SpawnOptionsWithoutStdio
} from 'node:child_process'
import path from 'node:path'

import crossSpawn from 'cross-spawn'

export interface ProviderProcessResult {
  stdout: string
  stderr: string
  exitCode: number | null
  errorCode: string | null
  timedOut: boolean
}

export interface RunProviderProcessOptions {
  cwd?: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
  maxOutputBytes: number
  signal?: AbortSignal
}

/**
 * cross-spawn preserves argv semantics while handling Windows npm `.cmd`
 * shims with its audited cmd.exe escaping. Callers never opt into Node's
 * `shell:true` string-joining path.
 */
export function spawnProviderProcess(
  binaryPath: string,
  args: readonly string[],
  options: Omit<SpawnOptionsWithoutStdio, 'shell' | 'stdio'> = {}
): ChildProcessWithoutNullStreams {
  return crossSpawn(binaryPath, args, {
    ...options,
    windowsHide: options.windowsHide ?? true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe']
  }) as ChildProcessWithoutNullStreams
}

export function runProviderProcess(
  binaryPath: string,
  args: readonly string[],
  options: RunProviderProcessOptions
): Promise<ProviderProcessResult> {
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawnProviderProcess(binaryPath, args, {
        cwd: options.cwd,
        env: options.env
      })
    } catch (error) {
      const code = (error as { code?: unknown }).code
      resolve({
        stdout: '',
        stderr: '',
        exitCode: null,
        errorCode: typeof code === 'string' ? code : 'SPAWN_FAILED',
        timedOut: false
      })
      return
    }

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let exitCode: number | null = null
    let errorCode: string | null = null
    let timedOut = false
    let settled = false
    let terminating = false
    let terminationTimer: NodeJS.Timeout | null = null
    let forceFinishTimer: NodeJS.Timeout | null = null
    let exitFallbackTimer: NodeJS.Timeout | null = null
    let timeoutTimer: NodeJS.Timeout | null = null

    const removeAbortListener = () => {
      options.signal?.removeEventListener('abort', abort)
    }
    const clearTimers = () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer)
      }
      if (terminationTimer) {
        clearTimeout(terminationTimer)
      }
      if (forceFinishTimer) {
        clearTimeout(forceFinishTimer)
      }
      if (exitFallbackTimer) {
        clearTimeout(exitFallbackTimer)
      }
    }
    const finish = () => {
      if (settled) {
        return
      }
      settled = true
      clearTimers()
      removeAbortListener()
      resolve({
        stdout: Buffer.concat(stdoutChunks, stdoutBytes).toString('utf8'),
        stderr: Buffer.concat(stderrChunks, stderrBytes).toString('utf8'),
        exitCode,
        errorCode,
        timedOut
      })
    }
    const terminate = () => {
      if (terminating) {
        return
      }
      terminating = true
      child.kill('SIGTERM')
      terminationTimer = setTimeout(() => {
        if (!settled) {
          child.kill('SIGKILL')
        }
      }, 250)
      // A descendant can inherit the child's pipes and prevent `close` even
      // after the direct provider process exits. Never let that defeat the
      // caller's timeout or AbortSignal.
      forceFinishTimer = setTimeout(finish, 500)
    }
    const capture = (target: 'stdout' | 'stderr', input: Buffer | string) => {
      if (settled || errorCode === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
        return
      }
      const chunk = Buffer.isBuffer(input) ? input : Buffer.from(input)
      const currentBytes = target === 'stdout' ? stdoutBytes : stderrBytes
      if (currentBytes + chunk.length > options.maxOutputBytes) {
        errorCode ??= 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
        terminate()
        return
      }
      if (target === 'stdout') {
        stdoutChunks.push(Buffer.from(chunk))
        stdoutBytes += chunk.length
      } else {
        stderrChunks.push(Buffer.from(chunk))
        stderrBytes += chunk.length
      }
    }
    const abort = () => {
      if (settled) {
        return
      }
      errorCode ??= 'ABORT_ERR'
      terminate()
    }

    child.stdout?.on('data', (chunk) => capture('stdout', chunk))
    child.stderr?.on('data', (chunk) => capture('stderr', chunk))
    child.on('error', (error: Error & { code?: string }) => {
      errorCode ??= error.code ?? 'SPAWN_FAILED'
      finish()
    })
    child.on('exit', (code) => {
      exitCode = typeof code === 'number' ? code : null
      if (timeoutTimer) {
        clearTimeout(timeoutTimer)
        timeoutTimer = null
      }
      // Usually `close` follows immediately and captures the complete output.
      // This fallback handles wrappers that leave inherited stdio open.
      if (!settled) {
        exitFallbackTimer ??= setTimeout(finish, 100)
      }
    })
    child.on('close', (code) => {
      exitCode = typeof code === 'number' ? code : null
      finish()
    })

    timeoutTimer = setTimeout(() => {
      if (settled) {
        return
      }
      timedOut = true
      terminate()
    }, options.timeoutMs)

    if (options.signal?.aborted) {
      abort()
    } else {
      options.signal?.addEventListener('abort', abort, { once: true })
    }
  })
}

export function isWindowsCommandShimPath(
  binaryPath: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  return platform === 'win32' && /\.(?:cmd|bat)$/i.test(path.extname(binaryPath))
}

export function hasUnsafeWindowsShellMetacharacters(binaryPath: string): boolean {
  return /[&|<>^%\r\n]/.test(binaryPath)
}
