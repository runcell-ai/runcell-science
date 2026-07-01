import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import dotenv from 'dotenv'

import type { AgentRuntimeMode } from '@open-science/contracts'

export interface ServerConfig {
  host: string
  port: number
  sqlitePath: string
  logDir: string
  migrationDir: string
  nodeEnv: string
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'
  agentDefaultCwd: string
  agentDefaultRuntimeMode: AgentRuntimeMode
  codexBinaryPath: string
  codexHome: string | null
  codexDefaultModel: string | null
  codexApprovalPolicy: 'never' | 'on-request' | 'on-failure' | 'untrusted'
  codexSandbox: 'danger-full-access' | 'workspace-write' | 'read-only'
}

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const workspaceRoot = path.resolve(serverRoot, '../..')

dotenv.config({ path: path.join(workspaceRoot, '.env'), quiet: true })
dotenv.config({ path: path.join(serverRoot, '.env'), quiet: true })

const logLevels: ServerConfig['logLevel'][] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']
const rawPort = Number(process.env.SERVER_PORT ?? process.env.PORT ?? 4000)

function resolveWorkspacePath(value: string | undefined) {
  if (!value) {
    return null
  }

  return path.isAbsolute(value) ? value : path.resolve(workspaceRoot, value)
}

function resolveLogLevel(value: string | undefined): ServerConfig['logLevel'] {
  if (value && logLevels.includes(value as ServerConfig['logLevel'])) {
    return value as ServerConfig['logLevel']
  }

  return 'info'
}

function resolveRuntimeMode(value: string | undefined): AgentRuntimeMode {
  return value === 'default' ? 'default' : 'full_access'
}

function resolveCodexApprovalPolicy(value: string | undefined): ServerConfig['codexApprovalPolicy'] {
  switch (value) {
    case 'on-request':
    case 'on-failure':
    case 'untrusted':
      return value
    case 'never':
    default:
      return 'never'
  }
}

function resolveCodexSandbox(value: string | undefined): ServerConfig['codexSandbox'] {
  switch (value) {
    case 'workspace-write':
    case 'read-only':
      return value
    case 'danger-full-access':
    default:
      return 'danger-full-access'
  }
}

export const config: ServerConfig = {
  host: process.env.SERVER_HOST ?? '0.0.0.0',
  port: Number.isNaN(rawPort) ? 4000 : rawPort,
  sqlitePath: resolveWorkspacePath(process.env.SQLITE_PATH) ?? path.join(workspaceRoot, 'apps/server/data/open-science.sqlite'),
  logDir: resolveWorkspacePath(process.env.LOG_DIR) ?? path.join(workspaceRoot, 'logs/server'),
  migrationDir:
    resolveWorkspacePath(process.env.MIGRATION_DIR) ?? path.join(workspaceRoot, 'apps/server/src/db/migrations'),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  logLevel: resolveLogLevel(process.env.LOG_LEVEL),
  agentDefaultCwd: resolveWorkspacePath(process.env.AGENT_DEFAULT_CWD) ?? workspaceRoot,
  agentDefaultRuntimeMode: resolveRuntimeMode(process.env.AGENT_DEFAULT_RUNTIME_MODE),
  codexBinaryPath: process.env.CODEX_BINARY_PATH?.trim() || 'codex',
  codexHome: resolveWorkspacePath(process.env.CODEX_HOME) ?? null,
  codexDefaultModel: process.env.CODEX_DEFAULT_MODEL?.trim() || null,
  codexApprovalPolicy: resolveCodexApprovalPolicy(process.env.CODEX_APPROVAL_POLICY),
  codexSandbox: resolveCodexSandbox(process.env.CODEX_SANDBOX)
}

export function ensureRuntimeDirs(): void {
  fs.mkdirSync(config.logDir, { recursive: true })
  fs.mkdirSync(path.dirname(config.sqlitePath), { recursive: true })
}
