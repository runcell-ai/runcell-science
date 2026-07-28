import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  AgentProviderSetupInput,
  AgentProviderSnapshot
} from '@runcell-science/contracts'

import type {
  AgentProviderDefinition,
  ResolvedAgentProviderConfig
} from '../src/services/agent-provider-config-service'
import type {
  AgentProviderDriver,
  AgentProviderProbeResult
} from '../src/services/agent-provider-drivers'
import {
  AgentProviderRegistry,
  AgentProviderRegistryError,
  type AgentProviderRegistryConfigStore
} from '../src/services/agent-provider-registry'

function resolved(
  instanceId: string,
  input: AgentProviderSetupInput = {}
): ResolvedAgentProviderConfig {
  const binary = input.binaryPathOverride === undefined
    ? `/usr/local/bin/${instanceId}`
    : input.binaryPathOverride
  const home = input.configHomeOverride === undefined ? null : input.configHomeOverride
  return {
    instanceId,
    driver: instanceId,
    displayName: instanceId,
    configuredCommand: binary ?? instanceId,
    resolvedExecutablePath: binary,
    commandSource: input.binaryPathOverride === undefined ? 'discovered' : 'persisted',
    configHome: home,
    homeSource: home ? 'persisted' : 'default',
    configurationIssue: null,
    env: {}
  }
}

class FakeConfigStore implements AgentProviderRegistryConfigStore {
  readonly saved: Array<{ instanceId: string; input: AgentProviderSetupInput }> = []
  readonly resetIds: string[] = []
  private readonly values = new Map<string, AgentProviderSetupInput>()
  readonly definitions = new Map<string, AgentProviderDefinition>()
  readonly unknownSettings: Array<{
    instanceId: string
    driver: string
    binaryPathOverride: string | null
    configHomeOverride: string | null
  }> = []
  private readonly listeners = new Set<(instanceId: string) => void>()

  registerDefinition(definition: AgentProviderDefinition): void {
    this.definitions.set(definition.instanceId, definition)
  }

  resolve(instanceId: string, input?: AgentProviderSetupInput): ResolvedAgentProviderConfig {
    const current = this.values.get(instanceId) ?? {}
    return resolved(instanceId, {
      binaryPathOverride:
        input?.binaryPathOverride === undefined
          ? current.binaryPathOverride
          : input.binaryPathOverride,
      configHomeOverride:
        input?.configHomeOverride === undefined
          ? current.configHomeOverride
          : input.configHomeOverride
    })
  }

  save(instanceId: string, input: AgentProviderSetupInput): ResolvedAgentProviderConfig {
    this.saved.push({ instanceId, input })
    this.values.set(instanceId, { ...this.values.get(instanceId), ...input })
    this.emit(instanceId)
    return this.resolve(instanceId)
  }

  reset(instanceId: string): ResolvedAgentProviderConfig {
    this.resetIds.push(instanceId)
    this.values.delete(instanceId)
    this.emit(instanceId)
    return this.resolve(instanceId)
  }

  listUnknownStoredSettings(knownInstanceIds: Iterable<string>) {
    const known = new Set(knownInstanceIds)
    return this.unknownSettings.filter((settings) => !known.has(settings.instanceId))
  }

  onChange(listener: (instanceId: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  triggerChange(instanceId: string): void {
    this.emit(instanceId)
  }

  private emit(instanceId: string): void {
    for (const listener of this.listeners) {
      listener(instanceId)
    }
  }
}

function driver(
  instanceId: 'grok' | 'codex' | 'claude',
  probe: AgentProviderDriver['probe']
): AgentProviderDriver {
  const names = { grok: 'Grok Build', codex: 'CodeX', claude: 'Claude Code' }
  return {
    configuration: {
      instanceId,
      driver: instanceId,
      displayName: names[instanceId],
      defaultCommand: instanceId,
      binaryEnvKey: `${instanceId.toUpperCase()}_BINARY_PATH`,
      homeEnvKey: instanceId === 'grok' ? null : `${instanceId.toUpperCase()}_HOME`
    },
    instanceId,
    driver: instanceId,
    displayName: names[instanceId],
    loginMode: instanceId === 'claude' ? 'local_process' : 'device_code',
    loginCommand: `${instanceId} login`,
    docsUrl: `https://example.test/${instanceId}`,
    installInstructions: [],
    probe
  }
}

const ready: AgentProviderProbeResult = {
  installed: true,
  version: '1.0.0',
  availability: 'ready',
  auth: { status: 'authenticated' },
  message: null
}

test('registry exposes stable order and isolates provider probe failures', async () => {
  const config = new FakeConfigStore()
  const registry = new AgentProviderRegistry({
    configService: config,
    drivers: [
      driver('grok', async () => ready),
      driver('codex', async () => ({
        installed: true,
        version: '2.0.0',
        availability: 'needs_auth',
        auth: { status: 'unauthenticated' },
        message: 'Sign in required'
      })),
      driver('claude', async () => {
        throw new Error('protocol failed')
      })
    ]
  })

  try {
    const snapshots = await registry.refreshAll()
    assert.deepEqual(snapshots.map((snapshot) => snapshot.instanceId), ['grok', 'codex', 'claude'])
    assert.equal(snapshots[0]?.availability, 'ready')
    assert.equal(snapshots[1]?.availability, 'needs_auth')
    assert.equal(snapshots[2]?.availability, 'error')
    assert.match(snapshots[2]?.message ?? '', /protocol failed/)
  } finally {
    await registry.dispose()
  }
})

test('registry serves stale snapshot while deduplicated background refresh runs', async () => {
  const config = new FakeConfigStore()
  let now = new Date('2026-07-27T10:00:00.000Z')
  let resolveSecond!: (value: AgentProviderProbeResult) => void
  let probeCount = 0
  const secondProbe = new Promise<AgentProviderProbeResult>((resolve) => {
    resolveSecond = resolve
  })
  const registry = new AgentProviderRegistry({
    configService: config,
    drivers: [
      driver('grok', async () => {
        probeCount += 1
        return probeCount === 1 ? ready : secondProbe
      })
    ],
    now: () => now,
    snapshotTtlMs: 1_000
  })

  try {
    const first = await registry.refresh('grok')
    assert.equal(first.availability, 'ready')
    assert.equal(first.lastSuccessfulAt, '2026-07-27T10:00:00.000Z')

    now = new Date('2026-07-27T10:00:02.000Z')
    const duringRefresh = registry.listSnapshots()[0] as AgentProviderSnapshot
    assert.equal(duringRefresh.availability, 'ready')
    assert.equal(duringRefresh.refreshState, 'refreshing')

    const a = registry.refresh('grok')
    const b = registry.refresh('grok')
    await Promise.resolve()
    assert.equal(probeCount, 2)
    resolveSecond({
      installed: true,
      version: null,
      availability: 'error',
      auth: { status: 'unknown' },
      message: 'temporary failure'
    })
    const [afterA, afterB] = await Promise.all([a, b])
    assert.equal(afterA.stale, true)
    assert.equal(afterA.lastSuccessfulAt, first.lastSuccessfulAt)
    assert.deepEqual(afterA, afterB)
    afterA.auth.status = 'authenticated'
    assert.equal(registry.listSnapshots()[0]?.auth.status, 'unknown')
  } finally {
    resolveSecond(ready)
    await registry.dispose()
  }
})

test('fresh refresh waits for an older probe and then observes post-login auth state', async () => {
  const config = new FakeConfigStore()
  let probeCount = 0
  let resolveBeforeLogin!: (value: AgentProviderProbeResult) => void
  let resolveAfterLogin!: (value: AgentProviderProbeResult) => void
  const beforeLogin = new Promise<AgentProviderProbeResult>((resolve) => {
    resolveBeforeLogin = resolve
  })
  const afterLogin = new Promise<AgentProviderProbeResult>((resolve) => {
    resolveAfterLogin = resolve
  })
  const registry = new AgentProviderRegistry({
    configService: config,
    drivers: [
      driver('claude', async () => {
        probeCount += 1
        return probeCount === 1 ? beforeLogin : afterLogin
      })
    ]
  })

  try {
    const staleRefresh = registry.refresh('claude')
    await Promise.resolve()
    const postLoginRefresh = registry.refresh('claude', { fresh: true })
    assert.equal(probeCount, 1)

    resolveBeforeLogin({
      installed: true,
      version: '1.0.0',
      availability: 'needs_auth',
      auth: { status: 'unauthenticated' },
      message: 'Sign in required'
    })
    await staleRefresh
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(probeCount, 2)

    resolveAfterLogin(ready)
    const fresh = await postLoginRefresh
    assert.equal(fresh.auth.status, 'authenticated')
  } finally {
    resolveBeforeLogin(ready)
    resolveAfterLogin(ready)
    await registry.dispose()
  }
})

test('configuration generations cancel old probes and never leave refreshing state stuck', async () => {
  const config = new FakeConfigStore()
  let oldSignal: AbortSignal | undefined
  let resolveOld!: (value: AgentProviderProbeResult) => void
  let probeCount = 0
  const oldProbe = new Promise<AgentProviderProbeResult>((resolve) => {
    resolveOld = resolve
  })
  const registry = new AgentProviderRegistry({
    configService: config,
    drivers: [
      driver('codex', async (_resolved, options) => {
        probeCount += 1
        oldSignal = options?.signal
        return probeCount === 1 ? oldProbe : ready
      })
    ]
  })

  try {
    const refresh = registry.refresh('codex')
    await Promise.resolve()
    assert.equal(registry.listSnapshots()[0]?.refreshState, 'refreshing')
    config.triggerChange('codex')
    assert.equal(oldSignal?.aborted, true)
    const replacement = await registry.refresh('codex')
    assert.equal(replacement.refreshState, 'idle')
    assert.equal(replacement.availability, 'ready')

    resolveOld(ready)
    const settled = await refresh
    assert.equal(settled.refreshState, 'idle')
    assert.equal(registry.listSnapshots()[0]?.refreshState, 'idle')
  } finally {
    resolveOld(ready)
    await registry.dispose()
  }
})

test('registry disposal aborts active provider probes before awaiting them', async () => {
  const config = new FakeConfigStore()
  let observedAbort = false
  const registry = new AgentProviderRegistry({
    configService: config,
    disposeTimeoutMs: 100,
    drivers: [
      driver('grok', (_resolved, options) =>
        new Promise<AgentProviderProbeResult>((resolve) => {
          options?.signal?.addEventListener('abort', () => {
            observedAbort = true
            resolve(ready)
          }, { once: true })
        })
      )
    ]
  })

  void registry.refresh('grok')
  await Promise.resolve()
  await registry.dispose()
  assert.equal(observedAbort, true)
})

test('setup test is non-persistent and save requires a successful probe', async () => {
  const config = new FakeConfigStore()
  let nextProbe: AgentProviderProbeResult = ready
  const registry = new AgentProviderRegistry({
    configService: config,
    drivers: [driver('claude', async () => nextProbe)]
  })

  try {
    const candidate = await registry.testSetup('claude', {
      binaryPathOverride: '/custom/claude'
    })
    assert.equal(candidate.configuredCommand, '/custom/claude')
    assert.equal(config.saved.length, 0)

    nextProbe = {
      installed: true,
      version: null,
      availability: 'error',
      auth: { status: 'unknown' },
      message: 'bad protocol'
    }
    await assert.rejects(
      registry.saveSetup('claude', { binaryPathOverride: '/bad/claude' }),
      (error: unknown) =>
        error instanceof AgentProviderRegistryError &&
        error.code === 'setup_probe_failed'
    )
    assert.equal(config.saved.length, 0)

    nextProbe = {
      installed: true,
      version: '2.1.0',
      availability: 'needs_auth',
      auth: { status: 'unauthenticated' },
      message: 'Sign in required'
    }
    const saved = await registry.saveSetup('claude', {
      binaryPathOverride: '/good/claude'
    })
    assert.equal(config.saved.length, 1)
    assert.equal(saved.configuredCommand, '/good/claude')

    await registry.resetSetup('claude')
    assert.deepEqual(config.resetIds, ['claude'])
  } finally {
    await registry.dispose()
  }
})

test('per-instance setup operations reject overlapping test, save, and reset mutations', async () => {
  const config = new FakeConfigStore()
  let releaseProbe!: () => void
  const blockedProbe = new Promise<void>((resolve) => {
    releaseProbe = resolve
  })
  const registry = new AgentProviderRegistry({
    configService: config,
    drivers: [
      driver('claude', async () => {
        await blockedProbe
        return ready
      })
    ]
  })

  try {
    const active = registry.testSetup('claude', {
      binaryPathOverride: '/custom/claude'
    })
    await Promise.resolve()

    for (const overlapping of [
      () => registry.testSetup('claude', {}),
      () => registry.saveSetup('claude', {}),
      () => registry.resetSetup('claude')
    ]) {
      await assert.rejects(
        overlapping(),
        (error: unknown) =>
          error instanceof AgentProviderRegistryError &&
          error.code === 'provider_setup_busy' &&
          error.statusCode === 409
      )
    }
    releaseProbe()
    await active
  } finally {
    releaseProbe()
    await registry.dispose()
  }
})

test('registered driver metadata is open and unknown persisted instances remain visible', () => {
  const config = new FakeConfigStore()
  config.unknownSettings.push({
    instanceId: 'third_party',
    driver: 'custom_acp',
    binaryPathOverride: '/opt/custom/bin/agent',
    configHomeOverride: '/opt/custom/config'
  })
  const registry = new AgentProviderRegistry({
    configService: config,
    drivers: [driver('codex', async () => ready)]
  })

  const snapshots = registry.listSnapshots()
  assert.deepEqual(snapshots.map((snapshot) => snapshot.instanceId), ['codex', 'third_party'])
  assert.equal(config.definitions.get('codex')?.driver, 'codex')
  assert.equal(snapshots[1]?.driver, 'custom_acp')
  assert.equal(snapshots[1]?.capabilities.localSetup, false)
  assert.equal(snapshots[1]?.availability, 'error')
})

test('configuration read failures become error snapshots and background refresh never rejects', async () => {
  class BrokenConfigStore extends FakeConfigStore {
    override resolve(): ResolvedAgentProviderConfig {
      throw new Error('database unavailable')
    }
  }
  const registry = new AgentProviderRegistry({
    configService: new BrokenConfigStore(),
    drivers: [driver('grok', async () => ready)],
    snapshotTtlMs: 0
  })

  try {
    const initial = registry.listSnapshots()[0]
    assert.equal(initial?.availability, 'error')
    assert.equal(initial?.refreshState, 'idle')
    const refreshed = await registry.refresh('grok')
    assert.equal(refreshed.availability, 'error')
    assert.match(refreshed.message ?? '', /configuration could not be read/i)
  } finally {
    await registry.dispose()
  }
})
