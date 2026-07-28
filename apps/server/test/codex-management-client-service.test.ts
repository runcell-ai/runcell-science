import assert from 'node:assert/strict'
import test from 'node:test'

import type { ResolvedAgentProviderConfig } from '../src/services/agent-provider-config-service'
import {
  CodexManagementClientService,
  type CodexManagementClient,
  type CodexManagementConfigStore
} from '../src/services/codex-management-client-service'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

class FakeConfig implements CodexManagementConfigStore {
  generation = 0
  private readonly listeners = new Set<(instanceId: string) => void>()

  resolve(): ResolvedAgentProviderConfig {
    return {
      instanceId: 'codex',
      driver: 'codex',
      displayName: 'Codex',
      configuredCommand: `/bin/codex-${this.generation}`,
      resolvedExecutablePath: `/bin/codex-${this.generation}`,
      commandSource: 'persisted',
      configHome: `/config-${this.generation}`,
      homeSource: 'persisted',
      configurationIssue: null,
      env: {
        TEST_CONFIG_GENERATION: String(this.generation),
        CODEX_HOME: `/config-${this.generation}`
      }
    }
  }

  onChange(listener: (instanceId: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  change(): void {
    this.generation += 1
    for (const listener of this.listeners) {
      listener('codex')
    }
  }
}

class FakeClient implements CodexManagementClient {
  readonly initialize = deferred<unknown>()
  readonly listeners = new Map<string, Array<(...args: any[]) => void>>()
  disposed = false
  initializedNotifications = 0
  nonInitializeRequests = 0

  on(event: string, listener: (...args: any[]) => void): this {
    const listeners = this.listeners.get(event) ?? []
    listeners.push(listener)
    this.listeners.set(event, listeners)
    return this
  }

  async request<T>(method: string): Promise<T> {
    if (method === 'initialize') {
      return this.initialize.promise as Promise<T>
    }
    this.nonInitializeRequests += 1
    return `client-response-${this.nonInitializeRequests}` as T
  }

  notify(method: string): void {
    if (method === 'initialized') {
      this.initializedNotifications += 1
    }
  }

  dispose(): void {
    this.disposed = true
  }
}

test('Codex management initialization uses identity guards across configuration races', async () => {
  const config = new FakeConfig()
  const clients: FakeClient[] = []
  const optionsSeen: Array<{ binaryPath: string; env?: NodeJS.ProcessEnv }> = []
  const service = new CodexManagementClientService({
    configService: config,
    clientFactory: (options) => {
      optionsSeen.push(options)
      const client = new FakeClient()
      clients.push(client)
      return client
    }
  })
  let invalidations = 0
  service.onExit(() => {
    invalidations += 1
  })

  try {
    const firstRequest = service.request<string>('account/read', {}).then(
      () => 'resolved',
      (error: unknown) => error
    )
    assert.equal(clients.length, 1)
    config.change()
    assert.equal(clients[0]?.disposed, true)
    assert.equal(invalidations, 1)

    const secondRequest = service.request<string>('account/read', {})
    assert.equal(clients.length, 2)
    clients[0]?.initialize.resolve({})
    const firstResult = await firstRequest
    assert.ok(firstResult instanceof Error)
    assert.match(firstResult.message, /configuration changed/i)

    const joinedRequest = service.request<string>('model/list', {})
    assert.equal(clients.length, 2)
    clients[1]?.initialize.resolve({})
    assert.equal(await secondRequest, 'client-response-1')
    assert.equal(await joinedRequest, 'client-response-2')

    const reused = await service.request<string>('skills/list', {})
    assert.equal(reused, 'client-response-3')
    assert.equal(clients.length, 2)
    assert.equal(clients[1]?.disposed, false)
    assert.deepEqual(
      optionsSeen.map((options) => [
        options.binaryPath,
        options.env?.TEST_CONFIG_GENERATION,
        options.env?.CODEX_HOME
      ]),
      [
        ['/bin/codex-0', '0', '/config-0'],
        ['/bin/codex-1', '1', '/config-1']
      ]
    )
  } finally {
    service.dispose()
    assert.equal(clients[1]?.disposed, true)
  }
})
