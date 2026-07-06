import crypto from 'node:crypto'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { promisify } from 'node:util'

import type {
  JupyterPythonEnvStatus,
  JupyterRuntimeStatus,
  JupyterServerConnectionResponse,
  JupyterServerStatusResponse
} from '@runcell-science/contracts'

import { config } from '../config/env'

const execFileAsync = promisify(execFile)
const envStatusTtlMs = 30_000
const importTimeoutMs = 15_000
const readinessTimeoutMs = 30_000
const readinessIntervalMs = 250
const defaultReaperIntervalMs = 5 * 60 * 1000
const defaultIdleMs = 30 * 60 * 1000
const shutdownGraceMs = 3_000
const provisionStepTimeoutMs = 300_000
const installIpykernelTimeoutMs = 300_000

/**
 * Kernelspec name registered per workspace instance; UI and nbcli request it
 * explicitly so kernels always run on the PROJECT python, never on the
 * app-managed runtime env that hosts jupyter-server.
 */
export const workspaceKernelName = 'open-science-python'

interface LoggerLike {
  debug(message: string): void
  warn(message: string): void
}

interface JupyterServerEntry extends JupyterServerConnectionResponse {
  cwd: string
  child: ChildProcess
  instanceDir: string
  configDir: string
  runtimeFilesDir: string
  dataDir: string
  /** Project python baked into this instance's kernelspec at spawn time. */
  projectPython: string
  lastActivityAt: number
  shuttingDown: boolean
  spawnError: Error | null
}

interface CachedCheck {
  ok: boolean
  expiresAt: number
}

export interface JupyterServerManagerOptions {
  webOrigin?: string
  jupyterPythonPath?: string
  jupyterServerPythonPath?: string
  runtimeDir?: string
  env?: NodeJS.ProcessEnv
  logger?: LoggerLike
  disableReaper?: boolean
  reaperIntervalMs?: number
  idleMs?: number
}

export class JupyterEnvMissingError extends Error {
  constructor(readonly status: JupyterPythonEnvStatus) {
    super('Python environment is missing required Jupyter packages.')
    this.name = 'JupyterEnvMissingError'
  }
}

export class JupyterRuntimeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JupyterRuntimeError'
  }
}

export class JupyterStartError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JupyterStartError'
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function canExecute(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function sanitizeLogLine(line: string, token: string): string {
  return line.replaceAll(token, '[redacted]').replace(/([?&]token=)[^&\s]+/g, '$1[redacted]')
}

function attachDebugLogging(stream: NodeJS.ReadableStream, logger: LoggerLike | undefined, token: string): void {
  if (!logger) {
    return
  }

  let buffer = ''
  stream.on('data', (chunk: Buffer | string) => {
    buffer += chunk.toString()
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.length > 0) {
        logger.debug(sanitizeLogLine(line, token))
      }
    }
    if (buffer.length > 64_000) {
      logger.debug(sanitizeLogLine(buffer.slice(0, -128), token))
      buffer = buffer.slice(-128)
    }
  })
  stream.on('end', () => {
    if (buffer.length > 0) {
      logger.debug(sanitizeLogLine(buffer, token))
    }
  })
}

async function withAbortTimeout<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ms)
  try {
    return await work(controller.signal)
  } finally {
    clearTimeout(timeout)
  }
}

/** Exported for unit tests: exact install command for a given interpreter. */
export function buildIpykernelInstallCommand(
  uvPath: string | null,
  pythonPath: string
): { command: string; args: string[] } {
  if (uvPath) {
    return { command: uvPath, args: ['pip', 'install', '--python', pythonPath, 'ipykernel'] }
  }
  return { command: pythonPath, args: ['-m', 'pip', 'install', 'ipykernel'] }
}

export class JupyterServerManager {
  private readonly webOrigin: string
  private readonly jupyterPythonPath: string | undefined
  private readonly jupyterServerPythonPath: string | undefined
  private readonly runtimeDir: string
  private readonly runtimeEnvDir: string
  private readonly env: NodeJS.ProcessEnv
  private logger: LoggerLike | undefined
  private readonly registry = new Map<string, JupyterServerEntry>()
  private readonly inFlight = new Map<string, Promise<JupyterServerConnectionResponse>>()
  private readonly importChecks = new Map<string, CachedCheck>()
  private readonly idleMs: number
  private readonly reaper: NodeJS.Timeout | undefined
  private provisionPromise: Promise<string> | null = null
  private provisionError: string | null = null

  constructor(options: JupyterServerManagerOptions = {}) {
    this.webOrigin = options.webOrigin ?? config.webOrigin
    this.jupyterPythonPath = options.jupyterPythonPath ?? config.jupyterPythonPath
    this.jupyterServerPythonPath = options.jupyterServerPythonPath ?? config.jupyterServerPythonPath
    this.runtimeDir = options.runtimeDir ?? path.join(path.dirname(config.sqlitePath), 'jupyter')
    this.runtimeEnvDir = path.join(this.runtimeDir, 'runtime-env')
    this.env = options.env ?? process.env
    this.logger = options.logger
    this.idleMs = options.idleMs ?? defaultIdleMs

    if (!options.disableReaper) {
      this.reaper = setInterval(() => {
        void this.reapIdleServers()
      }, options.reaperIntervalMs ?? defaultReaperIntervalMs)
      this.reaper.unref()
    }
  }

  setLogger(logger: LoggerLike): void {
    this.logger = logger
  }

  resolveWorkspaceKey(cwd: string): string {
    return fs.realpathSync(cwd)
  }

  /** The PROJECT python that kernels run with (never runs jupyter-server). */
  resolvePythonPath(cwd: string): string | null {
    if (this.jupyterPythonPath?.trim()) {
      const configured = this.jupyterPythonPath.trim()
      return path.isAbsolute(configured) ? configured : path.resolve(configured)
    }

    const venvPython = path.join(cwd, '.venv', 'bin', 'python')
    if (fs.existsSync(venvPython)) {
      return path.resolve(venvPython)
    }

    return this.which('python3')
  }

  async envStatus(cwd: string): Promise<JupyterPythonEnvStatus> {
    const pythonPath = this.resolvePythonPath(cwd)
    if (!pythonPath) {
      return { pythonPath: null, hasIpykernel: false }
    }
    return {
      pythonPath,
      hasIpykernel: await this.cachedCanImport(pythonPath, 'ipykernel')
    }
  }

  /** Never provisions; safe for cheap polling. */
  async runtimeStatus(): Promise<JupyterRuntimeStatus> {
    if (this.provisionPromise) {
      return { ready: false, provisioning: true, error: null }
    }
    const python = this.configuredRuntimePython() ?? path.join(this.runtimeEnvDir, 'bin', 'python')
    const ready = fs.existsSync(python) && (await this.cachedCanImport(python, 'jupyter_server'))
    return { ready, provisioning: false, error: this.provisionError }
  }

  async status(cwd: string): Promise<JupyterServerStatusResponse> {
    const [runtime, python] = await Promise.all([this.runtimeStatus(), this.envStatus(cwd)])
    let running = false
    try {
      const entry = this.registry.get(this.resolveWorkspaceKey(cwd))
      running = entry ? await this.isEntryHealthy(entry) : false
    } catch {
      running = false
    }

    return { runtime, python, server: { running } }
  }

  async ensure(cwd: string): Promise<JupyterServerConnectionResponse> {
    const key = this.resolveWorkspaceKey(cwd)
    const pending = this.inFlight.get(key)
    if (pending) {
      return pending
    }

    const existing = this.registry.get(key)
    if (existing && (await this.isEntryHealthy(existing))) {
      // The kernelspec bakes in the project python at spawn time; if the
      // resolved interpreter changed since (e.g. a .venv appeared), keep
      // reusing the old server and kernels would silently run on the wrong
      // python. Restart instead.
      if (this.resolvePythonPath(key) === existing.projectPython) {
        existing.lastActivityAt = Date.now()
        return this.connectionForEntry(existing)
      }
      this.logger?.warn(`Project python changed for ${key}; restarting its Jupyter server.`)
    }

    if (existing) {
      await this.terminateEntry(existing)
    }

    // The health check above awaited; another ensure() may have started a
    // server for this key in the meantime.
    const racing = this.inFlight.get(key)
    if (racing) {
      return racing
    }

    const promise = this.startServer(key)
    this.inFlight.set(key, promise)
    try {
      return await promise
    } finally {
      this.inFlight.delete(key)
    }
  }

  /** Installs ipykernel into the PROJECT python. Throws JupyterEnvMissingError when no python exists. */
  async installIpykernel(cwd: string): Promise<JupyterPythonEnvStatus> {
    const pythonPath = this.resolvePythonPath(cwd)
    if (!pythonPath) {
      throw new JupyterEnvMissingError({ pythonPath: null, hasIpykernel: false })
    }

    const { command, args } = buildIpykernelInstallCommand(this.which('uv'), pythonPath)
    try {
      await execFileAsync(command, args, { timeout: installIpykernelTimeoutMs, env: this.env })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new JupyterRuntimeError(`Installing ipykernel into ${pythonPath} failed: ${lastLines(detail)}`)
    }

    this.importChecks.delete(importCheckKey(pythonPath, 'ipykernel'))
    return this.envStatus(cwd)
  }

  async shutdown(cwd: string): Promise<void> {
    let key: string
    try {
      key = this.resolveWorkspaceKey(cwd)
    } catch {
      return
    }

    const pending = this.inFlight.get(key)
    if (pending) {
      await pending.catch(() => undefined)
    }

    const entry = this.registry.get(key)
    if (entry) {
      await this.terminateEntry(entry)
    }
  }

  async disposeAll(): Promise<void> {
    if (this.reaper) {
      clearInterval(this.reaper)
    }
    await Promise.allSettled([...this.inFlight.values()])
    await Promise.all([...this.registry.values()].map((entry) => this.terminateEntry(entry)))
  }

  private configuredRuntimePython(): string | null {
    if (this.jupyterServerPythonPath?.trim()) {
      const configured = this.jupyterServerPythonPath.trim()
      return path.isAbsolute(configured) ? configured : path.resolve(configured)
    }
    return null
  }

  /**
   * Python that runs jupyter-server: explicit override, else the app-managed
   * env under runtimeDir, provisioned on demand (uv preferred, venv+pip
   * fallback). Concurrent callers share one provisioning run.
   */
  private async ensureRuntimePython(): Promise<string> {
    const configured = this.configuredRuntimePython()
    if (configured) {
      if (!(await this.cachedCanImport(configured, 'jupyter_server'))) {
        throw new JupyterRuntimeError(`JUPYTER_SERVER_PYTHON (${configured}) cannot import jupyter_server.`)
      }
      return configured
    }

    const python = path.join(this.runtimeEnvDir, 'bin', 'python')
    if (fs.existsSync(python) && (await this.cachedCanImport(python, 'jupyter_server'))) {
      return python
    }

    this.provisionPromise ??= this.provisionRuntimeEnv(python).then(
      (result) => {
        this.provisionPromise = null
        this.provisionError = null
        return result
      },
      (error: unknown) => {
        this.provisionPromise = null
        this.provisionError = error instanceof Error ? error.message : String(error)
        throw error
      }
    )
    return this.provisionPromise
  }

  private async provisionRuntimeEnv(python: string): Promise<string> {
    this.logger?.warn(`Provisioning Jupyter runtime environment at ${this.runtimeEnvDir} (first run only).`)
    await fs.promises.rm(this.runtimeEnvDir, { recursive: true, force: true })
    await fs.promises.mkdir(this.runtimeDir, { recursive: true })

    const uv = this.which('uv')
    try {
      if (uv) {
        await execFileAsync(uv, ['venv', this.runtimeEnvDir], { timeout: provisionStepTimeoutMs, env: this.env })
        await execFileAsync(uv, ['pip', 'install', '--python', python, 'jupyter-server'], {
          timeout: provisionStepTimeoutMs,
          env: this.env
        })
      } else {
        const bootstrap = this.which('python3')
        if (!bootstrap) {
          throw new JupyterRuntimeError('Neither uv nor python3 is available to provision the Jupyter runtime.')
        }
        await execFileAsync(bootstrap, ['-m', 'venv', this.runtimeEnvDir], {
          timeout: provisionStepTimeoutMs,
          env: this.env
        })
        await execFileAsync(python, ['-m', 'pip', 'install', 'jupyter-server'], {
          timeout: provisionStepTimeoutMs,
          env: this.env
        })
      }
    } catch (error) {
      if (error instanceof JupyterRuntimeError) {
        throw error
      }
      const detail = error instanceof Error ? error.message : String(error)
      throw new JupyterRuntimeError(`Provisioning the Jupyter runtime failed: ${lastLines(detail)}`)
    }

    this.importChecks.delete(importCheckKey(python, 'jupyter_server'))
    if (!(await this.cachedCanImport(python, 'jupyter_server'))) {
      throw new JupyterRuntimeError('Jupyter runtime provisioning finished but jupyter_server is not importable.')
    }
    return python
  }

  private which(executable: string): string | null {
    const paths = (this.env.PATH ?? '').split(path.delimiter).filter(Boolean)
    for (const candidateDir of paths) {
      const candidate = path.resolve(candidateDir, executable)
      if (canExecute(candidate)) {
        return candidate
      }
    }
    return null
  }

  private async cachedCanImport(pythonPath: string, moduleName: string): Promise<boolean> {
    const key = importCheckKey(pythonPath, moduleName)
    const cached = this.importChecks.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.ok
    }
    let ok = false
    try {
      await execFileAsync(pythonPath, ['-c', `import ${moduleName}`], {
        timeout: importTimeoutMs,
        env: this.env
      })
      ok = true
    } catch {
      ok = false
    }
    this.importChecks.set(key, { ok, expiresAt: Date.now() + envStatusTtlMs })
    return ok
  }

  private async startServer(cwd: string): Promise<JupyterServerConnectionResponse> {
    const env = await this.envStatus(cwd)
    if (!env.pythonPath || !env.hasIpykernel) {
      throw new JupyterEnvMissingError(env)
    }
    const runtimePython = await this.ensureRuntimePython()

    const port = await this.pickPort()
    const token = crypto.randomBytes(24).toString('hex')
    const baseUrl = `http://127.0.0.1:${port}/`
    const wsUrl = `ws://127.0.0.1:${port}/`
    const instanceDirs = await this.createInstanceDirs(env.pythonPath)

    const args = [
      '-m',
      'jupyter_server',
      `--ServerApp.ip=127.0.0.1`,
      `--ServerApp.port=${port}`,
      '--ServerApp.port_retries=0',
      `--IdentityProvider.token=${token}`,
      '--ServerApp.open_browser=False',
      `--ServerApp.allow_origin=${this.webOrigin}`,
      `--ServerApp.root_dir=${cwd}`,
      '--ServerApp.terminals_enabled=False',
      `--MultiKernelManager.default_kernel_name=${workspaceKernelName}`
    ]

    const child = spawn(runtimePython, args, {
      cwd,
      env: {
        ...this.env,
        JUPYTER_CONFIG_DIR: instanceDirs.configDir,
        JUPYTER_RUNTIME_DIR: instanceDirs.runtimeFilesDir,
        // Makes the per-instance kernelspec (project python) resolvable and
        // searched before the runtime env's own specs.
        JUPYTER_PATH: instanceDirs.dataDir
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    attachDebugLogging(child.stdout, this.logger, token)
    attachDebugLogging(child.stderr, this.logger, token)

    const entry: JupyterServerEntry = {
      cwd,
      baseUrl,
      wsUrl,
      token,
      child,
      instanceDir: instanceDirs.instanceDir,
      configDir: instanceDirs.configDir,
      runtimeFilesDir: instanceDirs.runtimeFilesDir,
      dataDir: instanceDirs.dataDir,
      projectPython: env.pythonPath,
      lastActivityAt: Date.now(),
      shuttingDown: false,
      spawnError: null
    }
    this.registry.set(cwd, entry)

    child.once('error', (error) => {
      entry.spawnError = error
    })

    child.once('exit', (code, signal) => {
      const current = this.registry.get(cwd)
      if (current?.child === child) {
        this.registry.delete(cwd)
      }
      if (!entry.shuttingDown) {
        this.logger?.warn(`Jupyter server exited unexpectedly for ${cwd} with code ${code ?? 'null'} signal ${signal ?? 'null'}.`)
      }
      fs.rm(entry.instanceDir, { recursive: true, force: true }, () => undefined)
    })

    try {
      await this.waitForReady(entry)
      return this.connectionForEntry(entry)
    } catch (error) {
      await this.terminateEntry(entry)
      if (error instanceof JupyterStartError) {
        throw error
      }
      throw new JupyterStartError('Jupyter server failed to become ready.')
    }
  }

  private async createInstanceDirs(projectPython: string): Promise<{
    instanceDir: string
    configDir: string
    runtimeFilesDir: string
    dataDir: string
  }> {
    await fs.promises.mkdir(this.runtimeDir, { recursive: true })
    const instanceDir = await fs.promises.mkdtemp(path.join(this.runtimeDir, 'instance-'))
    const configDir = path.join(instanceDir, 'config')
    const runtimeFilesDir = path.join(instanceDir, 'runtime')
    const dataDir = path.join(instanceDir, 'data')
    const kernelDir = path.join(dataDir, 'kernels', workspaceKernelName)
    await fs.promises.mkdir(configDir)
    await fs.promises.mkdir(runtimeFilesDir)
    await fs.promises.mkdir(kernelDir, { recursive: true })
    await fs.promises.writeFile(
      path.join(kernelDir, 'kernel.json'),
      `${JSON.stringify(
        {
          argv: [projectPython, '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
          display_name: 'Python (workspace)',
          language: 'python'
        },
        null,
        2
      )}\n`
    )
    return { instanceDir, configDir, runtimeFilesDir, dataDir }
  }

  private pickPort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer()
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          if (address && typeof address === 'object') {
            resolve(address.port)
            return
          }
          reject(new Error('Failed to allocate a local port.'))
        })
      })
    })
  }

  private async waitForReady(entry: JupyterServerEntry): Promise<void> {
    const deadline = Date.now() + readinessTimeoutMs
    while (Date.now() < deadline) {
      if (entry.child.exitCode !== null || entry.child.signalCode !== null) {
        throw new JupyterStartError('Jupyter server exited before it was ready.')
      }
      if (entry.spawnError) {
        throw new JupyterStartError(`Jupyter server failed to spawn: ${entry.spawnError.message}`)
      }
      if (await this.fetchOk(`${entry.baseUrl}api/status`, entry.token, 1_000)) {
        return
      }
      await delay(readinessIntervalMs)
    }
    throw new JupyterStartError('Timed out waiting for Jupyter server readiness.')
  }

  private async fetchOk(url: string, token: string, timeoutMs: number): Promise<boolean> {
    try {
      const response = await withAbortTimeout(timeoutMs, (signal) =>
        fetch(url, {
          headers: {
            Authorization: `token ${token}`
          },
          signal
        })
      )
      return response.status === 200
    } catch {
      return false
    }
  }

  private async isEntryHealthy(entry: JupyterServerEntry): Promise<boolean> {
    if (entry.child.exitCode !== null || entry.child.signalCode !== null) {
      this.registry.delete(entry.cwd)
      return false
    }
    return this.fetchOk(`${entry.baseUrl}api/status`, entry.token, 1_000)
  }

  private async runningKernelCount(entry: JupyterServerEntry): Promise<number | null> {
    try {
      const response = await withAbortTimeout(2_000, (signal) =>
        fetch(`${entry.baseUrl}api/kernels`, {
          headers: {
            Authorization: `token ${entry.token}`
          },
          signal
        })
      )
      if (!response.ok) {
        return null
      }
      const body = await response.json()
      return Array.isArray(body) ? body.length : null
    } catch {
      return null
    }
  }

  private async reapIdleServers(): Promise<void> {
    const now = Date.now()
    for (const entry of this.registry.values()) {
      if (now - entry.lastActivityAt <= this.idleMs) {
        continue
      }
      const kernels = await this.runningKernelCount(entry)
      if (kernels === 0) {
        await this.terminateEntry(entry)
      }
    }
  }

  private async terminateEntry(entry: JupyterServerEntry): Promise<void> {
    if (entry.shuttingDown) {
      return
    }
    entry.shuttingDown = true
    this.registry.delete(entry.cwd)

    if (entry.child.exitCode === null && entry.child.signalCode === null) {
      entry.child.kill('SIGTERM')
      const exited = await this.waitForExit(entry.child, shutdownGraceMs)
      if (!exited && entry.child.exitCode === null && entry.child.signalCode === null) {
        entry.child.kill('SIGKILL')
        await this.waitForExit(entry.child, shutdownGraceMs)
      }
    }

    await fs.promises.rm(entry.instanceDir, { recursive: true, force: true })
  }

  private waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) {
      return Promise.resolve(true)
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        child.off('exit', onExit)
        resolve(false)
      }, timeoutMs)
      timeout.unref()

      const onExit = () => {
        clearTimeout(timeout)
        resolve(true)
      }

      child.once('exit', onExit)
    })
  }

  private connectionForEntry(entry: JupyterServerEntry): JupyterServerConnectionResponse {
    return {
      baseUrl: entry.baseUrl,
      wsUrl: entry.wsUrl,
      token: entry.token
    }
  }
}

function importCheckKey(pythonPath: string, moduleName: string): string {
  return `${pythonPath}\0${moduleName}`
}

function lastLines(text: string, count = 5): string {
  const lines = text.trim().split(/\r?\n/)
  return lines.slice(-count).join('\n')
}

export const jupyterServerManager = new JupyterServerManager()
