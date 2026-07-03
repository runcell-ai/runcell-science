import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import dotenv from 'dotenv'

import type { AgentRuntimeMode } from '@open-science/contracts'

export interface ServerConfig {
  workspaceRoot: string
  host: string
  port: number
  sqlitePath: string
  checkpointGitDir: string
  logDir: string
  migrationDir: string
  nodeEnv: string
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'
  webOrigin: string
  agentDefaultCwd: string
  agentDefaultRuntimeMode: AgentRuntimeMode
  /** Overrides the PROJECT python used for kernels (tests / power users). */
  jupyterPythonPath: string | undefined
  /** Overrides the app-managed python that runs jupyter-server itself. */
  jupyterServerPythonPath: string | undefined
  codexBinaryPath: string
  codexHome: string | null
  codexDefaultModel: string | null
  codexApprovalPolicy: 'never' | 'on-request' | 'on-failure' | 'untrusted'
  codexSandbox: 'danger-full-access' | 'workspace-write' | 'read-only'
  claudeCodeBinaryPath: string
  claudeConfigDir: string | null
  claudeDefaultModel: string | null
  claudePermissionMode: 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan' | 'dontAsk'
  claudeAllowDangerouslySkipPermissions: boolean
}

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const workspaceRoot = path.resolve(serverRoot, '../..')

dotenv.config({ path: path.join(workspaceRoot, '.env'), quiet: true })
dotenv.config({ path: path.join(serverRoot, '.env'), quiet: true })

const logLevels: ServerConfig['logLevel'][] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']
const defaultServerPort = 27184
const rawPort = Number(process.env.SERVER_PORT ?? process.env.PORT ?? defaultServerPort)

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

function resolveClaudePermissionMode(value: string | undefined): ServerConfig['claudePermissionMode'] {
  switch (value) {
    case 'default':
    case 'acceptEdits':
    case 'plan':
    case 'dontAsk':
      return value
    case 'bypassPermissions':
    default:
      return 'bypassPermissions'
  }
}

function resolveBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue
  }

  return value === '1' || value.toLowerCase() === 'true'
}

export const config: ServerConfig = {
  workspaceRoot,
  host: process.env.SERVER_HOST ?? '0.0.0.0',
  port: Number.isNaN(rawPort) ? defaultServerPort : rawPort,
  sqlitePath: resolveWorkspacePath(process.env.SQLITE_PATH) ?? path.join(workspaceRoot, 'apps/server/data/open-science.sqlite'),
  checkpointGitDir:
    resolveWorkspacePath(process.env.CHECKPOINT_GIT_DIR) ?? path.join(workspaceRoot, 'apps/server/data/checkpoints.git'),
  logDir: resolveWorkspacePath(process.env.LOG_DIR) ?? path.join(workspaceRoot, 'logs/server'),
  migrationDir:
    resolveWorkspacePath(process.env.MIGRATION_DIR) ?? path.join(workspaceRoot, 'apps/server/src/db/migrations'),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  logLevel: resolveLogLevel(process.env.LOG_LEVEL),
  webOrigin: process.env.WEB_ORIGIN?.trim() || 'http://localhost:27183',
  agentDefaultCwd: resolveWorkspacePath(process.env.AGENT_DEFAULT_CWD) ?? workspaceRoot,
  agentDefaultRuntimeMode: resolveRuntimeMode(process.env.AGENT_DEFAULT_RUNTIME_MODE),
  jupyterPythonPath: process.env.JUPYTER_PYTHON?.trim() || undefined,
  jupyterServerPythonPath: process.env.JUPYTER_SERVER_PYTHON?.trim() || undefined,
  codexBinaryPath: process.env.CODEX_BINARY_PATH?.trim() || 'codex',
  codexHome: resolveWorkspacePath(process.env.CODEX_HOME) ?? null,
  codexDefaultModel: process.env.CODEX_DEFAULT_MODEL?.trim() || null,
  codexApprovalPolicy: resolveCodexApprovalPolicy(process.env.CODEX_APPROVAL_POLICY),
  codexSandbox: resolveCodexSandbox(process.env.CODEX_SANDBOX),
  claudeCodeBinaryPath: process.env.CLAUDE_CODE_BINARY_PATH?.trim() || 'claude',
  claudeConfigDir: resolveWorkspacePath(process.env.CLAUDE_CONFIG_DIR) ?? null,
  claudeDefaultModel: process.env.CLAUDE_DEFAULT_MODEL?.trim() || null,
  claudePermissionMode: resolveClaudePermissionMode(process.env.CLAUDE_PERMISSION_MODE),
  claudeAllowDangerouslySkipPermissions: resolveBoolean(
    process.env.CLAUDE_ALLOW_DANGEROUSLY_SKIP_PERMISSIONS,
    true
  )
}

export function ensureRuntimeDirs(): void {
  fs.mkdirSync(config.logDir, { recursive: true })
  fs.mkdirSync(path.dirname(config.sqlitePath), { recursive: true })
  fs.mkdirSync(path.dirname(config.checkpointGitDir), { recursive: true })
}
