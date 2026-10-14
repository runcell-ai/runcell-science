import type { ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import net from 'node:net'

import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk/v2'

import { config } from '../../../config/env'
import { agentIntegrationEnv } from '../../env-utils'
import { spawnProviderProcess } from '../../provider-process-launch'
import { sanitizeProviderOutput } from '../../provider-output-sanitizer'

const SERVER_READY_PREFIX = 'opencode server listening'
const SERVER_START_TIMEOUT_MS = 30_000
const SERVER_STOP_GRACE_MS = 1_000
export const OPENCODE_SDK_VERSION = '1.18.4'
export const OPENCODE_REQUEST_TIMEOUT_MS = 30_000

export interface OpenCodeServerConnection {
  readonly url: string
  readonly username: string
  readonly password: string | null
  readonly owned: boolean
  createClient(directory: string): OpencodeClient
  onExit(listener: (error: Error) => void): () => void
  dispose(): Promise<void>
}

function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('OpenCode port probe returned no TCP port.')))
        return
      }
      server.close((error) => {
        if (error) reject(error)
        else resolve(address.port)
      })
    })
  })
}

function basicAuthorization(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`
}

function createClientFactory(input: {
  url: string
  username: string
  password: string | null
}): (directory: string) => OpencodeClient {
  return (directory) =>
    createOpencodeClient({
      baseUrl: input.url,
      directory,
      throwOnError: true,
      ...(input.password
        ? { headers: { Authorization: basicAuthorization(input.username, input.password) } }
        : {})
    })
}

export function validateExternalOpenCodeServer(input: { url: string; password: string | null }): string {
  let parsed: URL
  try {
    parsed = new URL(input.url)
  } catch {
    throw new Error('OPENCODE_SERVER_URL must be a valid HTTP or HTTPS URL.')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('OPENCODE_SERVER_URL must use HTTP or HTTPS.')
  }
  if (parsed.username || parsed.password) {
    throw new Error('OPENCODE_SERVER_URL must not contain credentials; use the username/password variables instead.')
  }
  if (parsed.search || parsed.hash) {
    throw new Error('OPENCODE_SERVER_URL must not contain a query string or fragment.')
  }

  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]'])
  const loopback = loopbackHosts.has(parsed.hostname.toLowerCase())
  if (parsed.protocol === 'http:' && !loopback) {
    throw new Error('Remote OPENCODE_SERVER_URL connections must use HTTPS.')
  }
  if (!loopback && !input.password) {
    throw new Error('Remote OPENCODE_SERVER_URL connections require OPENCODE_SERVER_PASSWORD.')
  }
  return parsed.toString().replace(/\/$/, '')
}

function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    let settled = false
    let forceTimer: NodeJS.Timeout | null = null
    const finish = () => {
      if (settled) return
      settled = true
      if (forceTimer) clearTimeout(forceTimer)
      resolve()
    }
    const signal = (name: NodeJS.Signals) => {
      try {
        if (process.platform === 'win32') child.kill(name)
        else process.kill(-child.pid!, name)
      } catch {
        // The child or process group already exited.
      }
    }

    child.once('exit', finish)
    signal('SIGTERM')
    forceTimer = setTimeout(() => {
      signal('SIGKILL')
      finish()
    }, SERVER_STOP_GRACE_MS)
    forceTimer.unref()
  })
}

async function startManagedServer(input: {
  directory: string
  sessionId?: string
  timeoutMs?: number
}): Promise<OpenCodeServerConnection> {
  const port = await findAvailablePort()
  const username = 'opencode'
  const password = randomBytes(24).toString('base64url')
  const child = spawnProviderProcess(
    config.opencodeBinaryPath,
    ['serve', '--hostname=127.0.0.1', `--port=${port}`],
    {
      cwd: input.directory,
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        ...agentIntegrationEnv(input.sessionId),
        OPENCODE_CONFIG_CONTENT: '{}',
        OPENCODE_SERVER_USERNAME: username,
        OPENCODE_SERVER_PASSWORD: password
      }
    }
  )
  child.stdin.end()

  let output = ''
  let readyUrl: string
  try {
    readyUrl = await new Promise<string>((resolve, reject) => {
      let settled = false
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      }
      const inspectOutput = (chunk: Buffer) => {
        output += chunk.toString('utf8')
        if (output.length > 64 * 1024) output = output.slice(-64 * 1024)
        for (const line of output.split(/\r?\n/)) {
          if (!line.startsWith(SERVER_READY_PREFIX)) continue
          const match = line.match(/on\s+(https?:\/\/[^\s]+)/)
          if (!match?.[1]) {
            fail(new Error(`Could not parse OpenCode server URL from: ${line}`))
            return
          }
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(match[1])
          return
        }
      }
      const timeoutMs = input.timeoutMs ?? SERVER_START_TIMEOUT_MS
      const timer = setTimeout(() => {
        fail(new Error(`Timed out waiting ${timeoutMs}ms for OpenCode server startup.`))
      }, timeoutMs)
      child.stdout.on('data', inspectOutput)
      child.stderr.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8')
        if (output.length > 64 * 1024) output = output.slice(-64 * 1024)
      })
      child.once('error', (error) => fail(error))
      child.once('exit', (code, signal) => {
        fail(
          new Error(
            `OpenCode server exited before startup (code=${code ?? 'null'}, signal=${signal ?? 'null'}).${
              output.trim() ? ` ${output.trim()}` : ''
            }`
          )
        )
      })
    })
  } catch (error) {
    await terminateChild(child)
    const detail = sanitizeProviderOutput(error, { ...process.env, OPENCODE_SERVER_PASSWORD: password })
    throw new Error(
      `Failed to start OpenCode CLI '${config.opencodeBinaryPath}': ${detail}. ` +
        'Install OpenCode and run `opencode auth login` for the provider you want to use.',
      { cause: error }
    )
  }

  const exitListeners = new Set<(error: Error) => void>()
  let disposing = false
  child.on('exit', (code, signal) => {
    if (disposing) return
    const recentOutput = sanitizeProviderOutput(output, { ...process.env, OPENCODE_SERVER_PASSWORD: password })
    const suffix = recentOutput ? ` Recent output: ${recentOutput}` : ''
    const error = new Error(
      `OpenCode server exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'}).${suffix}`
    )
    for (const listener of exitListeners) listener(error)
  })

  return {
    url: readyUrl,
    username,
    password,
    owned: true,
    createClient: createClientFactory({ url: readyUrl, username, password }),
    onExit(listener) {
      exitListeners.add(listener)
      return () => exitListeners.delete(listener)
    },
    async dispose() {
      if (disposing) return
      disposing = true
      exitListeners.clear()
      await terminateChild(child)
    }
  }
}

function connectExternalServer(): OpenCodeServerConnection {
  const url = validateExternalOpenCodeServer({
    url: config.opencodeServerUrl!,
    password: config.opencodeServerPassword
  })
  const username = config.opencodeServerUsername
  const password = config.opencodeServerPassword
  return {
    url,
    username,
    password,
    owned: false,
    createClient: createClientFactory({ url, username, password }),
    onExit() {
      return () => undefined
    },
    async dispose() {
      return
    }
  }
}

export async function connectOpenCodeServer(input: {
  directory: string
  sessionId?: string
  timeoutMs?: number
}): Promise<OpenCodeServerConnection> {
  if (config.opencodeServerUrl) {
    return connectExternalServer()
  }
  return startManagedServer(input)
}

export function isOpenCodeNotFound(error: unknown): boolean {
  const queue: unknown[] = [error]
  const seen = new Set<unknown>()
  for (let steps = 0; queue.length > 0 && steps < 32; steps += 1) {
    const value = queue.shift()
    if (!value || typeof value !== 'object' || seen.has(value)) continue
    seen.add(value)
    const record = value as Record<string, unknown>
    const response = record.response
    const statuses = [
      record.status,
      record.statusCode,
      response && typeof response === 'object' ? (response as Record<string, unknown>).status : undefined
    ].filter((status): status is number => typeof status === 'number')
    if (statuses.includes(404)) return true
    if (statuses.length > 0) continue
    if (record.name === 'NotFoundError' || record._tag === 'NotFoundError') return true
    for (const key of ['cause', 'body', 'error', 'data']) {
      if (record[key] !== undefined) queue.push(record[key])
    }
  }
  return false
}

export function parseOpenCodeModelSlug(slug: string | null | undefined): {
  providerID: string
  modelID: string
} | null {
  const value = slug?.trim()
  if (!value) return null
  const separator = value.indexOf('/')
  if (separator <= 0 || separator === value.length - 1) return null
  return { providerID: value.slice(0, separator), modelID: value.slice(separator + 1) }
}

function parseVersion(value: string): [number, number, number] | null {
  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)/)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

export function isSupportedOpenCodeVersion(value: string): boolean {
  const actual = parseVersion(value)
  const expected = parseVersion(OPENCODE_SDK_VERSION)!
  if (!actual || actual[0] !== expected[0]) return false
  for (let index = 1; index < expected.length; index += 1) {
    if (actual[index]! > expected[index]!) return true
    if (actual[index]! < expected[index]!) return false
  }
  return true
}

export async function assertOpenCodeCompatibility(client: OpencodeClient, signal?: AbortSignal): Promise<string> {
  const response = await client.global.health(signal ? { signal } : undefined)
  const version = response.data?.version?.trim()
  if (!response.data?.healthy || !version) {
    throw new Error('OpenCode health check did not report a healthy server and version.')
  }
  if (!isSupportedOpenCodeVersion(version)) {
    throw new Error(
      `OpenCode ${version} is incompatible with SDK ${OPENCODE_SDK_VERSION}; ` +
        `install OpenCode >=${OPENCODE_SDK_VERSION} with the same major version.`
    )
  }
  return version
}
