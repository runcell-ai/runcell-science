import type {
  AgentProviderInstanceId,
  AgentProviderSetupInput,
  AgentProviderSnapshot
} from '@runcell-science/contracts'

import {
  agentProviderConfigService,
  type AgentProviderConfigService,
  type AgentProviderDefinition,
  type ResolvedAgentProviderConfig,
  type StoredAgentProviderSettings
} from './agent-provider-config-service'
import {
  builtinAgentProviderDrivers,
  sanitizeAgentProviderMessage,
  type AgentProviderDriver,
  type AgentProviderProbeResult
} from './agent-provider-drivers'

const DEFAULT_SNAPSHOT_TTL_MS = 30_000
const DEFAULT_DISPOSE_TIMEOUT_MS = 5_000
const SAFE_PROVIDER_SLUG = /^[a-z][a-z0-9_-]{0,63}$/

export interface AgentProviderRegistryConfigStore {
  registerDefinition(definition: AgentProviderDefinition): void
  resolve(instanceId: AgentProviderInstanceId, input?: AgentProviderSetupInput): ResolvedAgentProviderConfig
  save(instanceId: AgentProviderInstanceId, input: AgentProviderSetupInput): ResolvedAgentProviderConfig
  reset(instanceId: AgentProviderInstanceId): ResolvedAgentProviderConfig
  listUnknownStoredSettings(knownInstanceIds: Iterable<string>): StoredAgentProviderSettings[]
  onChange(listener: (instanceId: AgentProviderInstanceId) => void): () => void
}

export interface AgentProviderRegistryOptions {
  configService: AgentProviderRegistryConfigStore
  drivers: AgentProviderDriver[]
  now: () => Date
  snapshotTtlMs: number
  disposeTimeoutMs: number
}

export interface AgentProviderRefreshOptions {
  /**
   * Wait for any older in-flight probe, then start a new one. Login completion
   * uses this so a pre-login probe cannot decide the post-login auth state.
   */
  fresh?: boolean
}

export class AgentProviderRegistryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number
  ) {
    super(message)
    this.name = 'AgentProviderRegistryError'
  }
}

function snapshotCopy(snapshot: AgentProviderSnapshot): AgentProviderSnapshot {
  return {
    ...snapshot,
    auth: { ...snapshot.auth },
    capabilities: { ...snapshot.capabilities },
    setup: {
      ...snapshot.setup,
      installInstructions: snapshot.setup.installInstructions.map((instruction) => ({ ...instruction }))
    }
  }
}

function resolvedCommandFields(resolved: ResolvedAgentProviderConfig) {
  return {
    configuredCommand: resolved.configuredCommand,
    resolvedExecutablePath: resolved.resolvedExecutablePath,
    configHome: resolved.configHome,
    commandSource: resolved.commandSource,
    homeSource: resolved.homeSource
  }
}

export class AgentProviderRegistry {
  private readonly options: AgentProviderRegistryOptions
  private readonly drivers = new Map<string, AgentProviderDriver>()
  private readonly snapshots = new Map<string, AgentProviderSnapshot>()
  private readonly generations = new Map<string, number>()
  private readonly inflight = new Map<string, { generation: number; promise: Promise<AgentProviderSnapshot> }>()
  private readonly activeProbes = new Set<Promise<AgentProviderSnapshot>>()
  private readonly activeProbeRuns = new Set<Promise<AgentProviderProbeResult>>()
  private readonly probeControllers = new Map<string, Set<AbortController>>()
  private readonly setupOperations = new Set<string>()
  private readonly unsubscribeConfig: () => void
  private initialized = false
  private started = false

  constructor(options: Partial<AgentProviderRegistryOptions> = {}) {
    this.options = {
      configService: options.configService ?? agentProviderConfigService,
      drivers: options.drivers ?? builtinAgentProviderDrivers,
      now: options.now ?? (() => new Date()),
      snapshotTtlMs: options.snapshotTtlMs ?? DEFAULT_SNAPSHOT_TTL_MS,
      disposeTimeoutMs: options.disposeTimeoutMs ?? DEFAULT_DISPOSE_TIMEOUT_MS
    }

    for (const driver of this.options.drivers) {
      if (this.drivers.has(driver.instanceId)) {
        throw new Error(`Duplicate Agent Provider instance '${driver.instanceId}'.`)
      }
      if (
        driver.configuration.instanceId !== driver.instanceId ||
        driver.configuration.driver !== driver.driver ||
        driver.configuration.displayName !== driver.displayName
      ) {
        throw new Error(`Agent Provider driver metadata does not match '${driver.instanceId}'.`)
      }
      this.options.configService.registerDefinition(driver.configuration)
      this.drivers.set(driver.instanceId, driver)
      this.generations.set(driver.instanceId, 0)
    }

    this.unsubscribeConfig = this.options.configService.onChange((instanceId) => {
      const driver = this.drivers.get(instanceId)
      if (!driver) {
        return
      }
      this.ensureInitialized()
      this.generations.set(instanceId, (this.generations.get(instanceId) ?? 0) + 1)
      for (const controller of this.probeControllers.get(instanceId) ?? []) {
        controller.abort()
      }
      const current = this.snapshots.get(instanceId) ?? this.pendingSnapshot(driver)
      try {
        const resolved = this.options.configService.resolve(instanceId)
        this.snapshots.set(instanceId, {
          ...current,
          ...resolvedCommandFields(resolved),
          refreshState: 'idle',
          stale: current.checkedAt !== null
        })
      } catch (error) {
        this.snapshots.set(instanceId, this.snapshotFromConfigError(driver, current, error))
      }
    })
  }

  start(): void {
    if (this.started) {
      return
    }
    this.started = true
    this.ensureInitialized()
    void this.refreshAll().catch(() => {
      // Every provider is normalized into an error snapshot. This final guard
      // prevents future implementation regressions from becoming unhandled
      // startup rejections.
    })
  }

  async dispose(): Promise<void> {
    this.unsubscribeConfig()
    for (const controllers of this.probeControllers.values()) {
      for (const controller of controllers) {
        controller.abort()
      }
    }
    const settling = Promise.allSettled([...this.activeProbes, ...this.activeProbeRuns])
    let timer: NodeJS.Timeout | null = null
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, this.options.disposeTimeoutMs)
    })
    await Promise.race([settling, timeout])
    if (timer) {
      clearTimeout(timer)
    }
    this.inflight.clear()
    this.activeProbes.clear()
    this.activeProbeRuns.clear()
    this.probeControllers.clear()
  }

  listSnapshots(): AgentProviderSnapshot[] {
    this.ensureInitialized()
    const now = this.options.now().getTime()
    for (const [instanceId, driver] of this.drivers) {
      const snapshot = this.snapshots.get(instanceId) ?? this.pendingSnapshot(driver)
      const checkedAt = snapshot.checkedAt ? Date.parse(snapshot.checkedAt) : Number.NaN
      if (
        snapshot.refreshState !== 'refreshing' &&
        (!Number.isFinite(checkedAt) || now - checkedAt >= this.options.snapshotTtlMs)
      ) {
        this.snapshots.set(instanceId, {
          ...snapshot,
          refreshState: 'refreshing',
          stale: snapshot.checkedAt !== null
        })
        void this.refresh(instanceId).catch(() => {
          // refresh() normally returns an error snapshot; keep a hard catch for
          // background stale-while-revalidate calls.
        })
      }
    }
    return this.orderedSnapshots()
  }

  async refreshAll(): Promise<AgentProviderSnapshot[]> {
    this.ensureInitialized()
    await Promise.all([...this.drivers.keys()].map((instanceId) => this.refresh(instanceId)))
    return this.orderedSnapshots()
  }

  async refresh(
    instanceId: AgentProviderInstanceId,
    options: AgentProviderRefreshOptions = {}
  ): Promise<AgentProviderSnapshot> {
    this.ensureInitialized()
    const driver = this.requireDriver(instanceId)
    const generation = this.generations.get(instanceId) ?? 0
    const existing = this.inflight.get(instanceId)
    if (existing?.generation === generation) {
      if (options.fresh) {
        await existing.promise
        return this.refresh(instanceId)
      }
      return existing.promise.then(snapshotCopy)
    }

    const current = this.snapshots.get(instanceId) ?? this.pendingSnapshot(driver)
    let resolved: ResolvedAgentProviderConfig
    try {
      resolved = this.options.configService.resolve(instanceId)
    } catch (error) {
      const snapshot = this.snapshotFromConfigError(driver, current, error)
      this.snapshots.set(instanceId, snapshot)
      return snapshotCopy(snapshot)
    }

    this.snapshots.set(instanceId, {
      ...current,
      ...resolvedCommandFields(resolved),
      refreshState: 'refreshing',
      stale: current.checkedAt !== null
    })

    const promise = this.runProbe(driver, resolved, true)
      .then((probe) => {
        if ((this.generations.get(instanceId) ?? 0) !== generation) {
          return this.snapshots.get(instanceId) ?? this.pendingSnapshot(driver)
        }
        const snapshot = this.snapshotFromProbe(
          driver,
          resolved,
          probe,
          this.snapshots.get(instanceId) ?? current
        )
        this.snapshots.set(instanceId, snapshot)
        return snapshot
      })
      .catch((error) => {
        const probe: AgentProviderProbeResult = {
          installed: resolved.resolvedExecutablePath !== null,
          version: null,
          availability: 'error',
          auth: { status: 'unknown' },
          message: sanitizeAgentProviderMessage(error, resolved.env)
        }
        const snapshot = this.snapshotFromProbe(driver, resolved, probe, current)
        if ((this.generations.get(instanceId) ?? 0) === generation) {
          this.snapshots.set(instanceId, snapshot)
          return snapshot
        }
        return this.snapshots.get(instanceId) ?? this.pendingSnapshot(driver)
      })
      .finally(() => {
        const active = this.inflight.get(instanceId)
        if (active?.promise === promise) {
          this.inflight.delete(instanceId)
        }
        this.activeProbes.delete(promise)
      })

    this.inflight.set(instanceId, { generation, promise })
    this.activeProbes.add(promise)
    return promise.then(snapshotCopy)
  }

  async testSetup(
    instanceId: AgentProviderInstanceId,
    input: AgentProviderSetupInput
  ): Promise<AgentProviderSnapshot> {
    return this.withSetupOperation(instanceId, async (driver) => {
      const resolved = this.options.configService.resolve(instanceId, input)
      const probe = await this.runProbe(driver, resolved, false)
      return this.snapshotFromProbe(driver, resolved, probe, null)
    })
  }

  async saveSetup(
    instanceId: AgentProviderInstanceId,
    input: AgentProviderSetupInput
  ): Promise<AgentProviderSnapshot> {
    return this.withSetupOperation(instanceId, async (driver) => {
      const candidate = this.options.configService.resolve(instanceId, input)
      const probe = await this.runProbe(driver, candidate, false)
      if (probe.availability === 'not_installed' || probe.availability === 'error') {
        throw new AgentProviderRegistryError(
          'setup_probe_failed',
          probe.message ?? `${driver.displayName} setup could not be verified.`,
          400
        )
      }
      this.options.configService.save(instanceId, input)
      return this.refresh(instanceId)
    })
  }

  async resetSetup(instanceId: AgentProviderInstanceId): Promise<AgentProviderSnapshot> {
    return this.withSetupOperation(instanceId, async () => {
      this.options.configService.reset(instanceId)
      return this.refresh(instanceId)
    })
  }

  private ensureInitialized(): void {
    if (this.initialized) {
      return
    }
    this.initialized = true
    for (const driver of this.drivers.values()) {
      this.snapshots.set(driver.instanceId, this.pendingSnapshot(driver))
    }
    try {
      for (const stored of this.options.configService.listUnknownStoredSettings(this.drivers.keys())) {
        this.snapshots.set(stored.instanceId, this.unknownDriverSnapshot(stored))
      }
    } catch {
      // A missing migration or unreadable database must not make importing the
      // runtime fail. Known drivers still remain discoverable and refreshable.
    }
  }

  private async withSetupOperation<T>(
    instanceId: AgentProviderInstanceId,
    operation: (driver: AgentProviderDriver) => Promise<T>
  ): Promise<T> {
    this.ensureInitialized()
    const driver = this.requireDriver(instanceId)
    if (this.setupOperations.has(instanceId)) {
      throw new AgentProviderRegistryError(
        'provider_setup_busy',
        `${driver.displayName} setup is already in progress.`,
        409
      )
    }
    this.setupOperations.add(instanceId)
    try {
      return await operation(driver)
    } finally {
      this.setupOperations.delete(instanceId)
    }
  }

  private runProbe(
    driver: AgentProviderDriver,
    resolved: ResolvedAgentProviderConfig,
    useManagedClient: boolean
  ): Promise<AgentProviderProbeResult> {
    if (resolved.configurationIssue) {
      return Promise.resolve({
        installed: resolved.resolvedExecutablePath !== null,
        version: null,
        availability: 'error',
        auth: { status: 'unknown' },
        message: resolved.configurationIssue
      })
    }
    const controller = new AbortController()
    const controllers = this.probeControllers.get(driver.instanceId) ?? new Set<AbortController>()
    controllers.add(controller)
    this.probeControllers.set(driver.instanceId, controllers)

    let task: Promise<AgentProviderProbeResult>
    task = Promise.resolve()
      .then(() =>
        driver.probe(resolved, {
          useManagedClient,
          signal: controller.signal
        })
      )
      .catch((error): AgentProviderProbeResult => ({
          installed: resolved.resolvedExecutablePath !== null,
          version: null,
          availability: 'error',
          auth: { status: 'unknown' },
          message: sanitizeAgentProviderMessage(error, resolved.env)
        }))
      .finally(() => {
        controllers.delete(controller)
        if (controllers.size === 0) {
          this.probeControllers.delete(driver.instanceId)
        }
        this.activeProbeRuns.delete(task)
      })
    this.activeProbeRuns.add(task)
    return task
  }

  private pendingSnapshot(driver: AgentProviderDriver): AgentProviderSnapshot {
    try {
      return this.pendingSnapshotFromResolved(driver, this.options.configService.resolve(driver.instanceId))
    } catch (error) {
      const definition = driver.configuration
      return {
        ...this.baseSnapshot(driver),
        configuredCommand: definition.defaultCommand,
        resolvedExecutablePath: null,
        configHome: null,
        commandSource: 'default',
        homeSource: definition.homeEnvKey ? 'default' : null,
        availability: 'error',
        message: `Provider configuration could not be read: ${sanitizeAgentProviderMessage(error)}`
      }
    }
  }

  private pendingSnapshotFromResolved(
    driver: AgentProviderDriver,
    resolved: ResolvedAgentProviderConfig
  ): AgentProviderSnapshot {
    return {
      ...this.baseSnapshot(driver),
      ...resolvedCommandFields(resolved)
    }
  }

  private baseSnapshot(driver: AgentProviderDriver): AgentProviderSnapshot {
    return {
      instanceId: driver.instanceId,
      driver: driver.driver,
      displayName: driver.displayName,
      installed: false,
      version: null,
      configuredCommand: driver.configuration.defaultCommand,
      resolvedExecutablePath: null,
      configHome: null,
      commandSource: 'default',
      homeSource: driver.configuration.homeEnvKey ? 'default' : null,
      availability: 'checking',
      auth: { status: 'unknown' },
      refreshState: 'idle',
      checkedAt: null,
      lastSuccessfulAt: null,
      stale: false,
      message: null,
      capabilities: {
        login: true,
        localSetup: true,
        loginMode: driver.loginMode
      },
      setup: {
        loginCommand: driver.loginCommand,
        docsUrl: driver.docsUrl,
        installInstructions: driver.installInstructions.map((instruction) => ({ ...instruction }))
      }
    }
  }

  private snapshotFromProbe(
    driver: AgentProviderDriver,
    resolved: ResolvedAgentProviderConfig,
    probe: AgentProviderProbeResult,
    previous: AgentProviderSnapshot | null
  ): AgentProviderSnapshot {
    const checkedAt = this.options.now().toISOString()
    const successfulProbe = probe.availability !== 'error'
    return {
      instanceId: driver.instanceId,
      driver: driver.driver,
      displayName: driver.displayName,
      installed: probe.installed,
      version: probe.version,
      ...resolvedCommandFields(resolved),
      availability: probe.availability,
      auth: { ...probe.auth },
      refreshState: 'idle',
      checkedAt,
      lastSuccessfulAt: successfulProbe ? checkedAt : previous?.lastSuccessfulAt ?? null,
      stale: !successfulProbe && Boolean(previous?.lastSuccessfulAt),
      message: probe.message,
      capabilities: {
        login: true,
        localSetup: true,
        loginMode: driver.loginMode
      },
      setup: {
        loginCommand: driver.loginCommand,
        docsUrl: driver.docsUrl,
        installInstructions: driver.installInstructions.map((instruction) => ({ ...instruction }))
      }
    }
  }

  private snapshotFromConfigError(
    driver: AgentProviderDriver,
    previous: AgentProviderSnapshot,
    error: unknown
  ): AgentProviderSnapshot {
    return {
      ...previous,
      availability: 'error',
      auth: { status: 'unknown' },
      refreshState: 'idle',
      checkedAt: this.options.now().toISOString(),
      stale: Boolean(previous.lastSuccessfulAt),
      message: `Provider configuration could not be read: ${sanitizeAgentProviderMessage(error)}`
    }
  }

  private unknownDriverSnapshot(stored: StoredAgentProviderSettings): AgentProviderSnapshot {
    const driver = SAFE_PROVIDER_SLUG.test(stored.driver) ? stored.driver : 'unknown'
    return {
      instanceId: stored.instanceId,
      driver,
      displayName: stored.instanceId,
      installed: false,
      version: null,
      configuredCommand: stored.binaryPathOverride ?? '',
      resolvedExecutablePath: null,
      configHome: stored.configHomeOverride,
      commandSource: stored.binaryPathOverride ? 'persisted' : 'default',
      homeSource: stored.configHomeOverride ? 'persisted' : null,
      availability: 'error',
      auth: { status: 'unknown' },
      refreshState: 'idle',
      checkedAt: null,
      lastSuccessfulAt: null,
      stale: false,
      message: `No registered Agent Provider driver can manage '${stored.instanceId}'.`,
      capabilities: {
        login: false,
        localSetup: false,
        loginMode: 'manual_only'
      },
      setup: {
        loginCommand: null,
        docsUrl: null,
        installInstructions: []
      }
    }
  }

  private orderedSnapshots(): AgentProviderSnapshot[] {
    const known = [...this.drivers.keys()]
      .map((instanceId) => this.snapshots.get(instanceId))
      .filter((snapshot): snapshot is AgentProviderSnapshot => snapshot !== undefined)
    const unknown = [...this.snapshots.entries()]
      .filter(([instanceId]) => !this.drivers.has(instanceId))
      .map(([, snapshot]) => snapshot)
      .sort((left, right) => left.instanceId.localeCompare(right.instanceId))
    return [...known, ...unknown].map(snapshotCopy)
  }

  private requireDriver(instanceId: AgentProviderInstanceId): AgentProviderDriver {
    const driver = this.drivers.get(instanceId)
    if (!driver) {
      throw new AgentProviderRegistryError(
        'provider_instance_not_found',
        `Unknown Agent Provider instance '${instanceId}'.`,
        404
      )
    }
    return driver
  }
}

let agentProviderRegistrySingleton: AgentProviderRegistry | null = null

export function getAgentProviderRegistry(): AgentProviderRegistry {
  if (!agentProviderRegistrySingleton) {
    agentProviderRegistrySingleton = new AgentProviderRegistry({
      configService: agentProviderConfigService as AgentProviderConfigService
    })
  }
  return agentProviderRegistrySingleton
}
