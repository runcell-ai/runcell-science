import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import Database from 'better-sqlite3'

import {
  AgentProviderConfigError,
  AgentProviderConfigService,
  requireAgentProviderExecutable
} from '../src/services/agent-provider-config-service'

function executable(filePath: string): string {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, '#!/bin/sh\nexit 0\n')
  chmodSync(filePath, 0o755)
  return filePath
}

function database(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE agent_provider_instance_settings (
      instance_id TEXT PRIMARY KEY,
      driver TEXT NOT NULL,
      binary_path_override TEXT,
      config_home_override TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  return db
}

test('config resolution honors persisted, environment, discovered, and default precedence per field', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'open-science-provider-config-'))
  const db = database()
  const environment: NodeJS.ProcessEnv = { PATH: '' }
  try {
    const discovered = executable(path.join(root, '.grok', 'bin', 'grok'))
    const service = new AgentProviderConfigService({
      db: () => db,
      environment: () => environment,
      homeDir: () => root,
      workspaceRoot: root
    })

    const discoveredConfig = service.resolve('grok')
    assert.equal(discoveredConfig.commandSource, 'discovered')
    assert.equal(discoveredConfig.resolvedExecutablePath, realpathSync(discovered))

    const envBinary = executable(path.join(root, 'env', 'codex'))
    const envHome = path.join(root, 'env-codex-home')
    mkdirSync(envHome)
    environment.CODEX_BINARY_PATH = envBinary
    environment.CODEX_HOME = envHome
    const envConfig = service.resolve('codex')
    assert.equal(envConfig.commandSource, 'environment')
    assert.equal(envConfig.homeSource, 'environment')

    const persistedBinary = executable(path.join(root, 'persisted', 'codex'))
    const persistedHome = path.join(root, 'persisted-home')
    mkdirSync(persistedHome)
    const persisted = service.save('codex', {
      binaryPathOverride: persistedBinary,
      configHomeOverride: persistedHome
    })
    assert.equal(persisted.commandSource, 'persisted')
    assert.equal(persisted.homeSource, 'persisted')
    assert.equal(persisted.resolvedExecutablePath, realpathSync(persistedBinary))

    const reset = service.reset('codex')
    assert.equal(reset.commandSource, 'environment')
    assert.equal(reset.homeSource, 'environment')

    const missing = service.resolve('claude')
    assert.equal(missing.commandSource, 'default')
    assert.equal(missing.resolvedExecutablePath, null)
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('persisted setup rejects relative, missing, and non-executable binary paths', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'open-science-provider-invalid-'))
  const db = database()
  const service = new AgentProviderConfigService({
    db: () => db,
    environment: () => ({ PATH: '' }),
    homeDir: () => root,
    workspaceRoot: root
  })
  try {
    assert.throws(
      () => service.save('codex', { binaryPathOverride: 'relative/codex' }),
      (error: unknown) =>
        error instanceof AgentProviderConfigError &&
        error.code === 'invalid_binary_path'
    )
    assert.throws(
      () => service.save('codex', { binaryPathOverride: path.join(root, 'missing') }),
      (error: unknown) =>
        error instanceof AgentProviderConfigError &&
        error.code === 'invalid_binary_path'
    )
    const notExecutable = path.join(root, 'codex')
    writeFileSync(notExecutable, 'not executable')
    chmodSync(notExecutable, 0o644)
    assert.throws(
      () => service.save('codex', { binaryPathOverride: notExecutable }),
      (error: unknown) =>
        error instanceof AgentProviderConfigError &&
        error.code === 'invalid_binary_path'
    )
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('invalid persisted overrides degrade resolution and can still be reset', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'open-science-provider-stale-'))
  const db = database()
  const missingBinary = path.join(root, 'removed-codex')
  const missingHome = path.join(root, 'removed-home')
  const service = new AgentProviderConfigService({
    db: () => db,
    environment: () => ({ PATH: '' }),
    homeDir: () => root,
    workspaceRoot: root
  })
  const original = service.resolve('codex')
  db.prepare(
    `INSERT INTO agent_provider_instance_settings (
       instance_id, driver, binary_path_override, config_home_override
     ) VALUES (?, ?, ?, ?)`
  ).run('codex', 'codex', missingBinary, missingHome)

  try {
    const degraded = service.resolve('codex')
    assert.equal(degraded.commandSource, 'persisted')
    assert.equal(degraded.configuredCommand, missingBinary)
    assert.equal(degraded.resolvedExecutablePath, null)
    assert.equal(degraded.configHome, missingHome)

    const reset = service.reset('codex')
    assert.deepEqual(reset, original)
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('legacy relative overrides are never used as executable or config paths', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'open-science-provider-legacy-'))
  const db = database()
  db.prepare(
    `INSERT INTO agent_provider_instance_settings (
       instance_id, driver, binary_path_override, config_home_override
     ) VALUES (?, ?, ?, ?)`
  ).run('codex', 'codex', 'relative/codex', 'relative/config-home')

  const service = new AgentProviderConfigService({
    db: () => db,
    environment: () => ({ PATH: '' }),
    homeDir: () => root,
    workspaceRoot: root
  })
  try {
    const degraded = service.resolve('codex')
    assert.equal(degraded.resolvedExecutablePath, null)
    assert.equal(degraded.configHome, null)
    assert.match(degraded.configurationIssue ?? '', /binary path is invalid/i)
    assert.match(degraded.configurationIssue ?? '', /config home is invalid/i)
    assert.throws(
      () => requireAgentProviderExecutable(degraded),
      (error: unknown) =>
        error instanceof AgentProviderConfigError &&
        error.code === 'invalid_persisted_provider_setup' &&
        error.statusCode === 409
    )

    const reset = service.reset('codex')
    assert.equal(reset.configurationIssue, null)
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('test candidates require real executable and directory paths without persisting', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'open-science-provider-test-'))
  const db = database()
  const service = new AgentProviderConfigService({
    db: () => db,
    environment: () => ({ PATH: '' }),
    homeDir: () => root,
    workspaceRoot: root
  })
  try {
    assert.throws(
      () => service.resolve('claude', { binaryPathOverride: path.join(root, 'missing') }),
      (error: unknown) =>
        error instanceof AgentProviderConfigError &&
        error.code === 'invalid_binary_path'
    )
    assert.throws(
      () => service.resolve('claude', { configHomeOverride: path.join(root, 'missing-home') }),
      (error: unknown) =>
        error instanceof AgentProviderConfigError &&
        error.code === 'invalid_config_home'
    )
    assert.deepEqual(
      db.prepare('SELECT count(*) AS count FROM agent_provider_instance_settings').get(),
      { count: 0 }
    )
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('compiled drivers can register a new management-plane definition', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'open-science-provider-open-spi-'))
  const db = database()
  const service = new AgentProviderConfigService({
    db: () => db,
    environment: () => ({ PATH: '' }),
    homeDir: () => root,
    workspaceRoot: root
  })
  try {
    service.registerDefinition({
      instanceId: 'custom_acp',
      driver: 'custom_acp',
      displayName: 'Custom ACP',
      defaultCommand: 'custom-agent',
      binaryEnvKey: null,
      homeEnvKey: null
    })
    const resolved = service.resolve('custom_acp')
    assert.equal(resolved.driver, 'custom_acp')
    assert.equal(resolved.configuredCommand, 'custom-agent')
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})
