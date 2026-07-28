import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type Database from 'better-sqlite3'
import type {
  AgentProviderConfigSource,
  AgentProviderDriverKind,
  AgentProviderInstanceId,
  AgentProviderSetupInput
} from '@runcell-science/contracts'

import { config } from '../config/env'
import { getDb } from '../db/connection'
import {
  hasUnsafeWindowsShellMetacharacters,
  isWindowsCommandShimPath
} from '../runtime/provider-process-launch'

export const BUILTIN_AGENT_PROVIDER_INSTANCE_IDS = ['grok', 'codex', 'claude'] as const
export type BuiltinAgentProviderInstanceId = (typeof BUILTIN_AGENT_PROVIDER_INSTANCE_IDS)[number]
const SAFE_PROVIDER_SLUG = /^[a-z][a-z0-9_-]{0,63}$/

export interface AgentProviderDefinition {
  instanceId: AgentProviderInstanceId
  driver: AgentProviderDriverKind
  displayName: string
  defaultCommand: string
  binaryEnvKey: string | null
  homeEnvKey: string | null
}

export const BUILTIN_AGENT_PROVIDER_DEFINITIONS: Readonly<
  Record<BuiltinAgentProviderInstanceId, AgentProviderDefinition>
> = {
  grok: {
    instanceId: 'grok',
    driver: 'grok',
    displayName: 'Grok Build',
    defaultCommand: 'grok',
    binaryEnvKey: 'GROK_BINARY_PATH',
    homeEnvKey: null
  },
  codex: {
    instanceId: 'codex',
    driver: 'codex',
    displayName: 'CodeX',
    defaultCommand: 'codex',
    binaryEnvKey: 'CODEX_BINARY_PATH',
    homeEnvKey: 'CODEX_HOME'
  },
  claude: {
    instanceId: 'claude',
    driver: 'claude',
    displayName: 'Claude Code',
    defaultCommand: 'claude',
    binaryEnvKey: 'CLAUDE_CODE_BINARY_PATH',
    homeEnvKey: 'CLAUDE_CONFIG_DIR'
  }
}

export interface StoredAgentProviderSettings {
  instanceId: string
  driver: string
  binaryPathOverride: string | null
  configHomeOverride: string | null
}

interface StoredAgentProviderSettingsRow {
  instance_id: string
  driver: string
  binary_path_override: string | null
  config_home_override: string | null
}

export interface ResolvedAgentProviderConfig {
  instanceId: AgentProviderInstanceId
  driver: AgentProviderDriverKind
  displayName: string
  configuredCommand: string
  resolvedExecutablePath: string | null
  commandSource: AgentProviderConfigSource
  configHome: string | null
  homeSource: AgentProviderConfigSource | null
  configurationIssue: string | null
  env: NodeJS.ProcessEnv
}

export interface AgentProviderConfigServiceOptions {
  db: () => Database.Database
  environment: () => NodeJS.ProcessEnv
  homeDir: () => string
  platform: NodeJS.Platform
  workspaceRoot: string
  definitions: AgentProviderDefinition[]
}

export class AgentProviderConfigError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number
  ) {
    super(message)
    this.name = 'AgentProviderConfigError'
  }
}

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function sameDefinition(
  left: AgentProviderDefinition,
  right: AgentProviderDefinition
): boolean {
  return (
    left.instanceId === right.instanceId &&
    left.driver === right.driver &&
    left.displayName === right.displayName &&
    left.defaultCommand === right.defaultCommand &&
    left.binaryEnvKey === right.binaryEnvKey &&
    left.homeEnvKey === right.homeEnvKey
  )
}

function isMissingSettingsTable(error: unknown): boolean {
  return error instanceof Error && /no such table:\s*agent_provider_instance_settings/i.test(error.message)
}

function isExecutableFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) {
      return false
    }
    fs.accessSync(filePath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function canonicalExecutable(filePath: string): string | null {
  if (!isExecutableFile(filePath)) {
    return null
  }
  try {
    return fs.realpathSync(filePath)
  } catch {
    return path.resolve(filePath)
  }
}

export class AgentProviderConfigService {
  private readonly options: AgentProviderConfigServiceOptions
  private readonly definitions = new Map<AgentProviderInstanceId, AgentProviderDefinition>()
  private readonly listeners = new Set<(instanceId: AgentProviderInstanceId) => void>()

  constructor(options: Partial<AgentProviderConfigServiceOptions> = {}) {
    this.options = {
      db: options.db ?? getDb,
      environment: options.environment ?? (() => process.env),
      homeDir: options.homeDir ?? os.homedir,
      platform: options.platform ?? process.platform,
      workspaceRoot: options.workspaceRoot ?? config.workspaceRoot,
      definitions: options.definitions ?? Object.values(BUILTIN_AGENT_PROVIDER_DEFINITIONS)
    }
    for (const definition of this.options.definitions) {
      this.registerDefinition(definition)
    }
  }

  registerDefinition(definition: AgentProviderDefinition): void {
    if (!SAFE_PROVIDER_SLUG.test(definition.instanceId) || !SAFE_PROVIDER_SLUG.test(definition.driver)) {
      throw new Error(`Unsafe Agent Provider definition '${definition.instanceId}:${definition.driver}'.`)
    }
    if (!definition.displayName.trim() || !definition.defaultCommand.trim()) {
      throw new Error(`Incomplete Agent Provider definition '${definition.instanceId}'.`)
    }
    if (this.definitions.has(definition.instanceId)) {
      const existing = this.definitions.get(definition.instanceId)
      if (!existing || !sameDefinition(existing, definition)) {
        throw new Error(`Conflicting Agent Provider definition '${definition.instanceId}'.`)
      }
      return
    }
    this.definitions.set(definition.instanceId, { ...definition })
  }

  requireDefinition(instanceId: AgentProviderInstanceId): AgentProviderDefinition {
    const definition = this.definitions.get(instanceId)
    if (!definition) {
      throw new AgentProviderConfigError(
        'provider_instance_not_found',
        `Unknown Agent Provider instance '${instanceId}'.`,
        404
      )
    }
    return definition
  }

  onChange(listener: (instanceId: AgentProviderInstanceId) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  resolve(
    instanceId: AgentProviderInstanceId,
    input?: AgentProviderSetupInput
  ): ResolvedAgentProviderConfig {
    const definition = this.requireDefinition(instanceId)
    const stored = this.readStoredSettings(definition.instanceId)
    const binaryOverride =
      input?.binaryPathOverride === undefined
        ? stored?.binaryPathOverride ?? null
        : trimOrNull(input.binaryPathOverride)
    const homeOverride =
      input?.configHomeOverride === undefined
        ? stored?.configHomeOverride ?? null
        : trimOrNull(input.configHomeOverride)

    if (input) {
      this.validateCandidateInput(input, true)
    }

    const configurationIssues: string[] = []
    const binaryComesFromStored =
      input?.binaryPathOverride === undefined && stored?.binaryPathOverride != null
    const homeComesFromStored =
      input?.configHomeOverride === undefined && stored?.configHomeOverride != null
    const storedBinaryIsStructurallyValid =
      !binaryComesFromStored ||
      !binaryOverride ||
      (
        path.isAbsolute(binaryOverride) &&
        !(
          isWindowsCommandShimPath(binaryOverride, this.options.platform) &&
          hasUnsafeWindowsShellMetacharacters(binaryOverride)
        )
      )
    const storedHomeIsStructurallyValid =
      !homeComesFromStored || !homeOverride || path.isAbsolute(homeOverride)
    if (!storedBinaryIsStructurallyValid) {
      configurationIssues.push('Saved binary path is invalid; reset or replace the local setup.')
    }
    if (!storedHomeIsStructurallyValid) {
      configurationIssues.push('Saved config home is invalid; reset or replace the local setup.')
    }

    const environment = this.options.environment()
    const command = this.resolveCommand(
      definition,
      environment,
      binaryOverride,
      storedBinaryIsStructurallyValid
    )
    const home = this.resolveHome(
      definition,
      environment,
      homeOverride,
      storedHomeIsStructurallyValid
    )
    const env = { ...environment }
    for (const key of ['CODEX_HOME', 'CLAUDE_CONFIG_DIR']) {
      if (typeof env[key] === 'string' && env[key]?.trim() === '') {
        delete env[key]
      }
    }
    if (definition.homeEnvKey) {
      if (home.value) {
        env[definition.homeEnvKey] = home.value
      } else {
        delete env[definition.homeEnvKey]
      }
    }

    return {
      instanceId: definition.instanceId,
      driver: definition.driver,
      displayName: definition.displayName,
      configuredCommand: command.configuredCommand,
      resolvedExecutablePath: command.resolvedExecutablePath,
      commandSource: command.source,
      configHome: home.value,
      homeSource: home.source,
      configurationIssue: configurationIssues.length > 0 ? configurationIssues.join(' ') : null,
      env
    }
  }

  save(instanceId: AgentProviderInstanceId, input: AgentProviderSetupInput): ResolvedAgentProviderConfig {
    const definition = this.requireDefinition(instanceId)
    const current = this.readStoredSettings(definition.instanceId)
    const binaryPathOverride =
      input.binaryPathOverride === undefined
        ? current?.binaryPathOverride ?? null
        : trimOrNull(input.binaryPathOverride)
    const configHomeOverride =
      input.configHomeOverride === undefined
        ? current?.configHomeOverride ?? null
        : trimOrNull(input.configHomeOverride)

    this.validatePersistedOverrides({ binaryPathOverride, configHomeOverride })

    const db = this.options.db()
    if (!binaryPathOverride && !configHomeOverride) {
      db.prepare('DELETE FROM agent_provider_instance_settings WHERE instance_id = ?').run(definition.instanceId)
    } else {
      db.prepare(
        `INSERT INTO agent_provider_instance_settings (
           instance_id, driver, binary_path_override, config_home_override
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT(instance_id) DO UPDATE SET
           driver = excluded.driver,
           binary_path_override = excluded.binary_path_override,
           config_home_override = excluded.config_home_override,
           updated_at = datetime('now')`
      ).run(definition.instanceId, definition.driver, binaryPathOverride, configHomeOverride)
    }

    this.emitChange(definition.instanceId)
    return this.resolve(definition.instanceId)
  }

  reset(instanceId: AgentProviderInstanceId): ResolvedAgentProviderConfig {
    const definition = this.requireDefinition(instanceId)
    this.options.db()
      .prepare('DELETE FROM agent_provider_instance_settings WHERE instance_id = ?')
      .run(definition.instanceId)
    this.emitChange(definition.instanceId)
    return this.resolve(definition.instanceId)
  }

  listUnknownStoredSettings(knownInstanceIds: Iterable<string>): StoredAgentProviderSettings[] {
    const known = new Set(knownInstanceIds)
    return this.readAllStoredSettings().filter(
      (settings) => SAFE_PROVIDER_SLUG.test(settings.instanceId) && !known.has(settings.instanceId)
    )
  }

  private emitChange(instanceId: AgentProviderInstanceId): void {
    for (const listener of this.listeners) {
      listener(instanceId)
    }
  }

  private readStoredSettings(instanceId: AgentProviderInstanceId): StoredAgentProviderSettings | null {
    let row: StoredAgentProviderSettingsRow | undefined
    try {
      row = this.options.db()
        .prepare(
          `SELECT instance_id, driver, binary_path_override, config_home_override
           FROM agent_provider_instance_settings
           WHERE instance_id = ?`
        )
        .get(instanceId) as StoredAgentProviderSettingsRow | undefined
    } catch (error) {
      // A few standalone scripts import runtime modules without running the
      // migration bootstrap. They should retain env/default behavior.
      if (isMissingSettingsTable(error)) {
        return null
      }
      throw error
    }
    if (!row) {
      return null
    }
    return {
      instanceId: row.instance_id,
      driver: row.driver,
      binaryPathOverride: row.binary_path_override,
      configHomeOverride: row.config_home_override
    }
  }

  private readAllStoredSettings(): StoredAgentProviderSettings[] {
    let rows: StoredAgentProviderSettingsRow[]
    try {
      rows = this.options.db()
        .prepare(
          `SELECT instance_id, driver, binary_path_override, config_home_override
           FROM agent_provider_instance_settings
           ORDER BY instance_id`
        )
        .all() as StoredAgentProviderSettingsRow[]
    } catch (error) {
      if (isMissingSettingsTable(error)) {
        return []
      }
      throw error
    }
    return rows.map((row) => ({
      instanceId: row.instance_id,
      driver: row.driver,
      binaryPathOverride: row.binary_path_override,
      configHomeOverride: row.config_home_override
    }))
  }

  private resolveCommand(
    definition: AgentProviderDefinition,
    environment: NodeJS.ProcessEnv,
    binaryOverride: string | null,
    overrideIsStructurallyValid = true
  ): {
    configuredCommand: string
    resolvedExecutablePath: string | null
    source: AgentProviderConfigSource
  } {
    if (binaryOverride) {
      return {
        configuredCommand: binaryOverride,
        resolvedExecutablePath: overrideIsStructurallyValid
          ? this.resolveExecutable(binaryOverride, environment)
          : null,
        source: 'persisted'
      }
    }

    const environmentCommand = definition.binaryEnvKey
      ? trimOrNull(environment[definition.binaryEnvKey])
      : null
    if (environmentCommand) {
      return {
        configuredCommand: environmentCommand,
        resolvedExecutablePath: this.resolveExecutable(environmentCommand, environment),
        source: 'environment'
      }
    }

    const discovered = this.discoverExecutable(definition.defaultCommand, environment)
    if (discovered) {
      return {
        configuredCommand: definition.defaultCommand,
        resolvedExecutablePath: discovered,
        source: 'discovered'
      }
    }

    return {
      configuredCommand: definition.defaultCommand,
      resolvedExecutablePath: null,
      source: 'default'
    }
  }

  private resolveHome(
    definition: AgentProviderDefinition,
    environment: NodeJS.ProcessEnv,
    homeOverride: string | null,
    overrideIsStructurallyValid = true
  ): { value: string | null; source: AgentProviderConfigSource | null } {
    if (!definition.homeEnvKey) {
      return { value: null, source: null }
    }
    if (homeOverride) {
      return {
        value: overrideIsStructurallyValid ? path.normalize(homeOverride) : null,
        source: 'persisted'
      }
    }
    const environmentHome = trimOrNull(environment[definition.homeEnvKey])
    if (environmentHome) {
      const resolved = path.isAbsolute(environmentHome)
        ? environmentHome
        : path.resolve(this.options.workspaceRoot, environmentHome)
      return { value: path.normalize(resolved), source: 'environment' }
    }
    return { value: null, source: 'default' }
  }

  private discoverExecutable(command: string, environment: NodeJS.ProcessEnv): string | null {
    const home = this.options.homeDir()
    const pathDirectories = (environment.PATH ?? '')
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean)
    const knownDirectories = [
      ...pathDirectories,
      path.join(home, '.local', 'bin'),
      path.join(home, '.nvs', 'default', 'bin'),
      path.join(home, '.grok', 'bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin'
    ]

    const executableNames =
      this.options.platform === 'win32' && !path.extname(command)
        ? [command, `${command}.exe`, `${command}.cmd`, `${command}.bat`]
        : [command]

    const seen = new Set<string>()
    for (const directory of knownDirectories) {
      for (const executableName of executableNames) {
        const candidate = path.resolve(directory, executableName)
        if (seen.has(candidate)) {
          continue
        }
        seen.add(candidate)
        const resolved = canonicalExecutable(candidate)
        if (
          resolved &&
          isWindowsCommandShimPath(resolved, this.options.platform) &&
          hasUnsafeWindowsShellMetacharacters(resolved)
        ) {
          continue
        }
        if (resolved) {
          return resolved
        }
      }
    }
    return null
  }

  private resolveExecutable(command: string, environment: NodeJS.ProcessEnv): string | null {
    if (path.isAbsolute(command)) {
      return canonicalExecutable(command)
    }
    if (command.includes('/') || command.includes('\\')) {
      return canonicalExecutable(path.resolve(this.options.workspaceRoot, command))
    }
    return this.discoverExecutable(command, environment)
  }

  private validateCandidateInput(input: AgentProviderSetupInput, requireExisting: boolean): void {
    const binaryPath = trimOrNull(input.binaryPathOverride)
    if (binaryPath && !path.isAbsolute(binaryPath)) {
      throw new AgentProviderConfigError(
        'invalid_binary_path',
        'Binary path overrides must be absolute paths.',
        400
      )
    }
    if (
      binaryPath &&
      this.options.platform === 'win32' &&
      isWindowsCommandShimPath(binaryPath, this.options.platform) &&
      hasUnsafeWindowsShellMetacharacters(binaryPath)
    ) {
      throw new AgentProviderConfigError(
        'invalid_binary_path',
        'Windows command shim paths contain unsupported shell metacharacters.',
        400
      )
    }

    const configHome = trimOrNull(input.configHomeOverride)
    if (configHome && !path.isAbsolute(configHome)) {
      throw new AgentProviderConfigError(
        'invalid_config_home',
        'Config home overrides must be absolute paths.',
        400
      )
    }

    if (
      binaryPath &&
      ((requireExisting && !isExecutableFile(binaryPath)) ||
        (fs.existsSync(binaryPath) && !isExecutableFile(binaryPath)))
    ) {
      throw new AgentProviderConfigError(
        'invalid_binary_path',
        'Binary path must point to an existing regular executable file.',
        400
      )
    }
    if (
      configHome &&
      ((requireExisting && (!fs.existsSync(configHome) || !fs.statSync(configHome).isDirectory())) ||
        (fs.existsSync(configHome) && !fs.statSync(configHome).isDirectory()))
    ) {
      throw new AgentProviderConfigError(
        'invalid_config_home',
        'Config home must point to a directory.',
        400
      )
    }
  }

  private validatePersistedOverrides(input: AgentProviderSetupInput): void {
    this.validateCandidateInput(input, true)
    const binaryPath = trimOrNull(input.binaryPathOverride)
    if (binaryPath && !isExecutableFile(binaryPath)) {
      throw new AgentProviderConfigError(
        'binary_not_executable',
        'Binary path must exist and be executable before it can be saved.',
        400
      )
    }
    const configHome = trimOrNull(input.configHomeOverride)
    if (configHome && (!fs.existsSync(configHome) || !fs.statSync(configHome).isDirectory())) {
      throw new AgentProviderConfigError(
        'config_home_not_found',
        'Config home must be an existing directory before it can be saved.',
        400
      )
    }
  }
}

export const agentProviderConfigService = new AgentProviderConfigService()

export function requireAgentProviderExecutable(
  resolved: ResolvedAgentProviderConfig
): string {
  if (resolved.configurationIssue) {
    throw new AgentProviderConfigError(
      'invalid_persisted_provider_setup',
      resolved.configurationIssue,
      409
    )
  }
  if (!resolved.resolvedExecutablePath) {
    throw new AgentProviderConfigError(
      'provider_not_installed',
      `${resolved.displayName} executable was not found.`,
      409
    )
  }
  return resolved.resolvedExecutablePath
}
