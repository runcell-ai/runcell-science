import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import dotenv from 'dotenv'

export interface ServerConfig {
  host: string
  port: number
  sqlitePath: string
  logDir: string
  migrationDir: string
  nodeEnv: string
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'
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

export const config: ServerConfig = {
  host: process.env.SERVER_HOST ?? '0.0.0.0',
  port: Number.isNaN(rawPort) ? 4000 : rawPort,
  sqlitePath: resolveWorkspacePath(process.env.SQLITE_PATH) ?? path.join(workspaceRoot, 'apps/server/data/open-science.sqlite'),
  logDir: resolveWorkspacePath(process.env.LOG_DIR) ?? path.join(workspaceRoot, 'logs/server'),
  migrationDir:
    resolveWorkspacePath(process.env.MIGRATION_DIR) ?? path.join(workspaceRoot, 'apps/server/src/db/migrations'),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  logLevel: resolveLogLevel(process.env.LOG_LEVEL)
}

export function ensureRuntimeDirs(): void {
  fs.mkdirSync(config.logDir, { recursive: true })
  fs.mkdirSync(path.dirname(config.sqlitePath), { recursive: true })
}
