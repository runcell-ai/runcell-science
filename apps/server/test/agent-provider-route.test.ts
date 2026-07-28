import assert from 'node:assert/strict'
import test from 'node:test'

import fastify from 'fastify'

import type { FastifyRequest } from 'fastify'

import type {
  AgentProviderLoginAttempt,
  AgentProviderSetupInput
} from '@runcell-science/contracts'

import { AgentProviderControlGuard } from '../src/http/agent-provider-control-guard'
import { createAgentProvidersRoute } from '../src/http/routes/agent-providers'
import type {
  AgentProviderDefinition,
  ResolvedAgentProviderConfig
} from '../src/services/agent-provider-config-service'
import type { AgentProviderDriver } from '../src/services/agent-provider-drivers'
import type { AgentProviderLoginService } from '../src/services/agent-provider-login-service'
import {
  AgentProviderRegistry,
  type AgentProviderRegistryConfigStore
} from '../src/services/agent-provider-registry'

class RouteConfigStore implements AgentProviderRegistryConfigStore {
  private readonly listeners = new Set<(instanceId: string) => void>()

  registerDefinition(_definition: AgentProviderDefinition): void {}

  resolve(instanceId: string, input: AgentProviderSetupInput = {}): ResolvedAgentProviderConfig {
    const binary = input.binaryPathOverride ?? `/usr/local/bin/${instanceId}`
    return {
      instanceId,
      driver: instanceId,
      displayName: instanceId,
      configuredCommand: binary,
      resolvedExecutablePath: binary,
      commandSource: input.binaryPathOverride === undefined ? 'discovered' : 'persisted',
      configHome: input.configHomeOverride ?? null,
      homeSource: input.configHomeOverride ? 'persisted' : 'default',
      configurationIssue: null,
      env: {}
    }
  }

  save(instanceId: string, input: AgentProviderSetupInput): ResolvedAgentProviderConfig {
    this.emit(instanceId)
    return this.resolve(instanceId, input)
  }

  reset(instanceId: string): ResolvedAgentProviderConfig {
    this.emit(instanceId)
    return this.resolve(instanceId)
  }

  listUnknownStoredSettings(): [] {
    return []
  }

  onChange(listener: (instanceId: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(instanceId: string): void {
    for (const listener of this.listeners) {
      listener(instanceId)
    }
  }
}

const driver: AgentProviderDriver = {
  configuration: {
    instanceId: 'codex',
    driver: 'codex',
    displayName: 'CodeX',
    defaultCommand: 'codex',
    binaryEnvKey: 'CODEX_BINARY_PATH',
    homeEnvKey: 'CODEX_HOME'
  },
  instanceId: 'codex',
  driver: 'codex',
  displayName: 'CodeX',
  loginMode: 'device_code',
  loginCommand: 'codex login --device-auth',
  docsUrl: 'https://example.test/codex',
  installInstructions: [],
  async probe() {
    return {
      installed: true,
      version: '0.144.1',
      availability: 'ready',
      auth: { status: 'authenticated' },
      message: null
    }
  }
}

async function fixture(
  guardOptions: { rateLimit?: number; invalidTokenRateLimit?: number; now?: () => number } = {},
  loginService?: Pick<AgentProviderLoginService, 'create' | 'get' | 'cancel'>
) {
  const registry = new AgentProviderRegistry({
    configService: new RouteConfigStore(),
    drivers: [driver]
  })
  await registry.refreshAll()
  const guard = new AgentProviderControlGuard({
    token: 'test-control-token',
    webOrigin: 'http://localhost:27183',
    serverPort: 27184,
    ...guardOptions
  })
  const server = fastify({ logger: false })
  await server.register(createAgentProvidersRoute({
    registry,
    guard,
    ...(loginService ? { loginService } : {})
  }))
  return { server, registry, guard }
}

test('control endpoints enforce loopback Host and Origin boundaries', async () => {
  const { server, registry, guard } = await fixture()
  try {
    const allowed = await server.inject({
      method: 'GET',
      url: '/api/agent-provider-control/token',
      headers: { host: 'localhost:27184', origin: 'http://localhost:27183' }
    })
    assert.equal(allowed.statusCode, 200)
    assert.deepEqual(allowed.json(), { token: 'test-control-token' })
    assert.equal(allowed.headers['cache-control'], 'no-store')

    const badHost = await server.inject({
      method: 'GET',
      url: '/api/agent-provider-control/token',
      headers: { host: 'attacker.example' }
    })
    assert.equal(badHost.statusCode, 403)
    assert.equal(badHost.json().error.code, 'invalid_control_host')

    assert.throws(
      () => guard.assertRead({
        headers: {},
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' }
      } as FastifyRequest),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'invalid_control_host'
    )

    const badOrigin = await server.inject({
      method: 'GET',
      url: '/api/agent-provider-instances',
      headers: { host: 'localhost:27184', origin: 'https://attacker.example' }
    })
    assert.equal(badOrigin.statusCode, 403)
    assert.equal(badOrigin.json().error.code, 'invalid_control_origin')

    const remote = await server.inject({
      method: 'GET',
      url: '/api/agent-provider-instances',
      headers: { host: 'localhost:27184' },
      remoteAddress: '192.168.1.20'
    })
    assert.equal(remote.statusCode, 403)
    assert.equal(remote.json().error.code, 'agent_provider_control_local_only')

    const protectedInventory = await server.inject({
      method: 'GET',
      url: '/api/agent-provider-instances',
      headers: { host: 'localhost:27184' }
    })
    assert.equal(protectedInventory.statusCode, 403)
    assert.equal(protectedInventory.json().error.code, 'invalid_control_token')

    const allowedInventory = await server.inject({
      method: 'GET',
      url: '/api/agent-provider-instances',
      headers: {
        host: 'localhost:27184',
        'x-runcell-control-token': 'test-control-token'
      }
    })
    assert.equal(allowedInventory.statusCode, 200)
    assert.equal(allowedInventory.json().instances[0].instanceId, 'codex')
  } finally {
    await server.close()
    await registry.dispose()
  }
})

test('invalid-token rate limiting cannot exhaust the authenticated mutation bucket', async () => {
  const { server, registry } = await fixture({ rateLimit: 2, invalidTokenRateLimit: 2 })
  try {
    for (let index = 0; index < 2; index += 1) {
      const rejected = await server.inject({
        method: 'POST',
        url: `/api/agent-provider-instances/${index === 0 ? 'codex' : 'unknown'}/refresh`,
        headers: {
          host: 'localhost:27184',
          'content-type': 'application/json',
          'x-runcell-control-token': 'wrong-token'
        },
        payload: {}
      })
      assert.equal(rejected.statusCode, 403)
      assert.equal(rejected.json().error.code, 'invalid_control_token')
    }

    const invalidLimited = await server.inject({
      method: 'POST',
      url: '/api/agent-provider-instances/codex/refresh',
      headers: {
        host: 'localhost:27184',
        'content-type': 'application/json',
        'x-runcell-control-token': 'wrong-token'
      },
      payload: {}
    })
    assert.equal(invalidLimited.statusCode, 429)
    assert.equal(invalidLimited.json().error.code, 'control_rate_limited')

    const authorized = await server.inject({
      method: 'POST',
      url: '/api/agent-provider-instances/codex/refresh',
      headers: {
        host: 'localhost:27184',
        'content-type': 'application/json',
        'x-runcell-control-token': 'test-control-token'
      },
      payload: {}
    })
    assert.equal(authorized.statusCode, 200)
  } finally {
    await server.close()
    await registry.dispose()
  }
})

test('mutations require JSON and the per-process control token', async () => {
  const { server, registry } = await fixture()
  try {
    const missingToken = await server.inject({
      method: 'POST',
      url: '/api/agent-provider-instances/codex/refresh',
      headers: { host: 'localhost:27184', 'content-type': 'application/json' },
      payload: {}
    })
    assert.equal(missingToken.statusCode, 403)
    assert.equal(missingToken.json().error.code, 'invalid_control_token')

    const wrongContentType = await server.inject({
      method: 'POST',
      url: '/api/agent-provider-instances/codex/refresh',
      headers: {
        host: 'localhost:27184',
        'content-type': 'text/plain',
        'x-runcell-control-token': 'test-control-token'
      },
      payload: '{}'
    })
    assert.equal(wrongContentType.statusCode, 415)

    const refreshed = await server.inject({
      method: 'POST',
      url: '/api/agent-provider-instances/codex/refresh',
      headers: {
        host: 'localhost:27184',
        'content-type': 'application/json',
        'x-runcell-control-token': 'test-control-token'
      },
      payload: {}
    })
    assert.equal(refreshed.statusCode, 200)
    assert.equal(refreshed.json().instance.availability, 'ready')

    const tested = await server.inject({
      method: 'POST',
      url: '/api/agent-provider-instances/codex/setup/test',
      headers: {
        host: 'localhost:27184',
        'content-type': 'application/json',
        'x-runcell-control-token': 'test-control-token'
      },
      payload: { binaryPathOverride: '/custom/codex' }
    })
    assert.equal(tested.statusCode, 200)
    assert.equal(tested.json().instance.configuredCommand, '/custom/codex')

    const unknown = await server.inject({
      method: 'POST',
      url: '/api/agent-provider-instances/unknown/refresh',
      headers: {
        host: 'localhost:27184',
        'content-type': 'application/json',
        'x-runcell-control-token': 'test-control-token'
      },
      payload: {}
    })
    assert.equal(unknown.statusCode, 404)
  } finally {
    await server.close()
    await registry.dispose()
  }
})

test('login attempt routes create, poll, and cancel an observable attempt', async () => {
  const attemptId = '123e4567-e89b-42d3-a456-426614174000'
  let attempt: AgentProviderLoginAttempt = {
    id: attemptId,
    instanceId: 'codex',
    status: 'awaiting_user',
    flow: {
      kind: 'device_code',
      verificationUrl: 'https://example.test/device',
      userCode: 'CODE-1234'
    },
    startedAt: '2026-07-27T12:00:00.000Z',
    expiresAt: '2026-07-27T12:10:00.000Z',
    finishedAt: null,
    message: null
  }
  const loginService = {
    create(instanceId: string) {
      assert.equal(instanceId, 'codex')
      return { ...attempt, flow: attempt.flow ? { ...attempt.flow } : null }
    },
    get(instanceId: string, requestedId: string) {
      assert.equal(instanceId, 'codex')
      assert.equal(requestedId, attemptId)
      return { ...attempt, flow: attempt.flow ? { ...attempt.flow } : null }
    },
    async cancel(instanceId: string, requestedId: string) {
      assert.equal(instanceId, 'codex')
      assert.equal(requestedId, attemptId)
      attempt = {
        ...attempt,
        status: 'cancelled',
        finishedAt: '2026-07-27T12:01:00.000Z',
        message: 'Login cancelled.'
      }
      return { ...attempt, flow: attempt.flow ? { ...attempt.flow } : null }
    }
  }
  const { server, registry } = await fixture({}, loginService)
  const headers = {
    host: 'localhost:27184',
    'content-type': 'application/json',
    'x-runcell-control-token': 'test-control-token'
  }
  try {
    const created = await server.inject({
      method: 'POST',
      url: '/api/agent-provider-instances/codex/login-attempts',
      headers,
      payload: {}
    })
    assert.equal(created.statusCode, 201)
    assert.equal(created.json().attempt.flow.userCode, 'CODE-1234')

    const polled = await server.inject({
      method: 'GET',
      url: `/api/agent-provider-instances/codex/login-attempts/${attemptId}`,
      headers
    })
    assert.equal(polled.statusCode, 200)
    assert.equal(polled.headers['cache-control'], 'no-store')
    assert.equal(polled.json().attempt.status, 'awaiting_user')

    const cancelled = await server.inject({
      method: 'POST',
      url: `/api/agent-provider-instances/codex/login-attempts/${attemptId}/cancel`,
      headers,
      payload: {}
    })
    assert.equal(cancelled.statusCode, 200)
    assert.equal(cancelled.json().attempt.status, 'cancelled')

    const invalidId = await server.inject({
      method: 'GET',
      url: '/api/agent-provider-instances/codex/login-attempts/not-a-uuid',
      headers
    })
    assert.equal(invalidId.statusCode, 400)
    assert.equal(invalidId.json().error.code, 'invalid_provider_login_attempt_id')
  } finally {
    await server.close()
    await registry.dispose()
  }
})
