import { config } from '../../../config/env'
import { CodexJsonRpcClient } from './json-rpc-client'

export type CodexCapabilityKey = 'configRead' | 'mcpServerStatusList' | 'skillsList'

export interface CodexCapabilityResult {
  supported: boolean
  error?: string
}

export interface CodexCapabilityReport {
  binaryPath: string
  initialized: boolean
  initializeError?: string
  capabilities: Record<CodexCapabilityKey, CodexCapabilityResult>
}

interface ProbeSpec {
  key: CodexCapabilityKey
  method: string
  params: unknown
  timeoutMs: number
}

const PROBE_TIMEOUT_MS = 15_000
// mcpServerStatus/list blocks until every configured MCP server finished its
// startup handshake (remote servers, stdio spawns), so it needs a much larger
// budget than plain config reads.
const MCP_STATUS_TIMEOUT_MS = 60_000

function buildProbeSpecs(cwd: string): ProbeSpec[] {
  return [
    { key: 'configRead', method: 'config/read', params: { includeLayers: true, cwd }, timeoutMs: PROBE_TIMEOUT_MS },
    { key: 'mcpServerStatusList', method: 'mcpServerStatus/list', params: {}, timeoutMs: MCP_STATUS_TIMEOUT_MS },
    { key: 'skillsList', method: 'skills/list', params: { cwds: [cwd] }, timeoutMs: PROBE_TIMEOUT_MS }
  ]
}

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs: number = PROBE_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`))
    }, timeoutMs)

    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    )
  })
}

function unsupported(error: unknown): CodexCapabilityResult {
  return {
    supported: false,
    error: error instanceof Error ? error.message : String(error)
  }
}

/**
 * Probes the locally installed codex binary for the management RPCs the MCP /
 * skills features rely on. Capabilities that fail to probe are reported as
 * unsupported so callers can degrade (read-only UI, hidden entry points)
 * instead of enforcing a minimum codex version.
 */
export async function probeCodexCapabilities(cwd: string = process.cwd()): Promise<CodexCapabilityReport> {
  const report: CodexCapabilityReport = {
    binaryPath: config.codexBinaryPath,
    initialized: false,
    capabilities: {
      configRead: { supported: false },
      mcpServerStatusList: { supported: false },
      skillsList: { supported: false }
    }
  }

  const client = new CodexJsonRpcClient({
    binaryPath: config.codexBinaryPath,
    env: {
      ...process.env,
      ...(config.codexHome ? { CODEX_HOME: config.codexHome } : {})
    }
  })
  // The probe owns this client; swallow async errors so they surface only as
  // rejected requests instead of crashing the process.
  client.on('error', () => {})

  try {
    try {
      await withTimeout(
        client.request('initialize', {
          clientInfo: {
            name: 'open_science',
            title: 'Runcell Science',
            version: '0.1.0'
          },
          capabilities: {
            experimentalApi: true
          }
        }),
        'initialize'
      )
      client.notify('initialized', {})
      report.initialized = true
    } catch (error) {
      report.initializeError = error instanceof Error ? error.message : String(error)
      return report
    }

    for (const spec of buildProbeSpecs(cwd)) {
      try {
        await withTimeout(client.request(spec.method, spec.params), spec.method, spec.timeoutMs)
        report.capabilities[spec.key] = { supported: true }
      } catch (error) {
        report.capabilities[spec.key] = unsupported(error)
      }
    }

    return report
  } finally {
    client.dispose()
  }
}
