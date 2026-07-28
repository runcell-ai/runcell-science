import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'

import type {
  AgentProviderControlTokenResponse,
  AgentProviderLoginAttemptResponse,
  AgentProviderSetupInput,
  AgentProviderSnapshotResponse,
  ApiErrorResponse,
  ListAgentProviderInstancesResponse
} from '@runcell-science/contracts'

import {
  AgentProviderControlError,
  agentProviderControlGuard,
  type AgentProviderControlGuard
} from '../agent-provider-control-guard'
import { AgentProviderConfigError } from '../../services/agent-provider-config-service'
import {
  AgentProviderLoginError,
  agentProviderLoginService,
  type AgentProviderLoginService
} from '../../services/agent-provider-login-service'
import {
  AgentProviderRegistryError,
  getAgentProviderRegistry,
  type AgentProviderRegistry
} from '../../services/agent-provider-registry'

const INSTANCE_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/
const ATTEMPT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_PATH_LENGTH = 4096

interface AgentProviderRouteDependencies {
  registry: AgentProviderRegistry
  guard: AgentProviderControlGuard
  loginService: Pick<AgentProviderLoginService, 'create' | 'get' | 'cancel'>
}

function sendError(reply: FastifyReply, error: unknown): FastifyReply {
  if (
    error instanceof AgentProviderControlError ||
    error instanceof AgentProviderConfigError ||
    error instanceof AgentProviderLoginError ||
    error instanceof AgentProviderRegistryError
  ) {
    return reply.code(error.statusCode).send({
      error: { code: error.code, message: error.message }
    } satisfies ApiErrorResponse)
  }
  return reply.code(502).send({
    error: {
      code: 'agent_provider_operation_failed',
      message: 'The Agent Provider operation failed.'
    }
  } satisfies ApiErrorResponse)
}

function requireAttemptId(request: FastifyRequest): string {
  const params = request.params as { attemptId?: unknown }
  if (typeof params.attemptId !== 'string' || !ATTEMPT_ID_PATTERN.test(params.attemptId)) {
    throw new AgentProviderLoginError(
      'invalid_provider_login_attempt_id',
      'Agent Provider login attempt ID is invalid.',
      400
    )
  }
  return params.attemptId
}

function requireInstanceId(request: FastifyRequest): string {
  const params = request.params as { instanceId?: unknown }
  if (typeof params.instanceId !== 'string' || !INSTANCE_ID_PATTERN.test(params.instanceId)) {
    throw new AgentProviderRegistryError(
      'invalid_provider_instance_id',
      'Agent Provider instance ID is invalid.',
      400
    )
  }
  return params.instanceId
}

function parseSetupInput(body: unknown): AgentProviderSetupInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AgentProviderConfigError('bad_request', 'A JSON setup object is required.', 400)
  }
  const record = body as Record<string, unknown>
  const allowedKeys = new Set(['binaryPathOverride', 'configHomeOverride'])
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new AgentProviderConfigError(
      'bad_request',
      'Only binaryPathOverride and configHomeOverride may be configured.',
      400
    )
  }
  const input: AgentProviderSetupInput = {}
  for (const key of allowedKeys) {
    const value = record[key]
    if (value === undefined) {
      continue
    }
    if (value !== null && typeof value !== 'string') {
      throw new AgentProviderConfigError('bad_request', `${key} must be a string or null.`, 400)
    }
    if (typeof value === 'string' && value.length > MAX_PATH_LENGTH) {
      throw new AgentProviderConfigError('bad_request', `${key} is too long.`, 400)
    }
    if (key === 'binaryPathOverride') {
      input.binaryPathOverride = value as string | null
    } else {
      input.configHomeOverride = value as string | null
    }
  }
  return input
}

function audit(
  request: FastifyRequest,
  action: string,
  instanceId: string,
  result: 'started' | 'succeeded' | 'failed'
): void {
  request.log.info(
    {
      action,
      instanceId,
      result,
      subsystem: 'agent-provider-control'
    },
    'Agent Provider control action'
  )
}

export function createAgentProvidersRoute(
  dependencies: Partial<AgentProviderRouteDependencies> = {}
): FastifyPluginAsync {
  return async (server) => {
    const registry = dependencies.registry ?? getAgentProviderRegistry()
    const guard = dependencies.guard ?? agentProviderControlGuard
    const loginService = dependencies.loginService ?? agentProviderLoginService

    server.get('/api/agent-provider-control/token', async (request, reply) => {
      try {
        guard.assertRead(request)
        reply.header('Cache-Control', 'no-store')
        reply.send({ token: guard.token } satisfies AgentProviderControlTokenResponse)
      } catch (error) {
        sendError(reply, error)
      }
    })

    server.get('/api/agent-provider-instances', async (request, reply) => {
      try {
        guard.assertAuthorizedRead(request)
        reply.header('Cache-Control', 'no-store')
        reply.send({
          instances: registry.listSnapshots()
        } satisfies ListAgentProviderInstancesResponse)
      } catch (error) {
        sendError(reply, error)
      }
    })

    server.post('/api/agent-provider-instances/:instanceId/refresh', async (request, reply) => {
      let instanceId = 'unknown'
      let authorized = false
      try {
        guard.assertMutation(request, 'refresh')
        authorized = true
        instanceId = requireInstanceId(request)
        audit(request, 'refresh', instanceId, 'started')
        const instance = await registry.refresh(instanceId)
        audit(request, 'refresh', instanceId, 'succeeded')
        reply.send({ instance } satisfies AgentProviderSnapshotResponse)
      } catch (error) {
        if (authorized) audit(request, 'refresh', instanceId, 'failed')
        sendError(reply, error)
      }
    })

    server.post('/api/agent-provider-instances/:instanceId/setup/test', async (request, reply) => {
      let instanceId = 'unknown'
      let authorized = false
      try {
        guard.assertMutation(request, 'setup-test')
        authorized = true
        instanceId = requireInstanceId(request)
        const input = parseSetupInput(request.body)
        audit(request, 'setup-test', instanceId, 'started')
        const instance = await registry.testSetup(instanceId, input)
        audit(request, 'setup-test', instanceId, 'succeeded')
        reply.send({ instance } satisfies AgentProviderSnapshotResponse)
      } catch (error) {
        if (authorized) audit(request, 'setup-test', instanceId, 'failed')
        sendError(reply, error)
      }
    })

    server.put('/api/agent-provider-instances/:instanceId/setup', async (request, reply) => {
      let instanceId = 'unknown'
      let authorized = false
      try {
        guard.assertMutation(request, 'setup-save')
        authorized = true
        instanceId = requireInstanceId(request)
        const input = parseSetupInput(request.body)
        audit(request, 'setup-save', instanceId, 'started')
        const instance = await registry.saveSetup(instanceId, input)
        audit(request, 'setup-save', instanceId, 'succeeded')
        reply.send({ instance } satisfies AgentProviderSnapshotResponse)
      } catch (error) {
        if (authorized) audit(request, 'setup-save', instanceId, 'failed')
        sendError(reply, error)
      }
    })

    server.delete('/api/agent-provider-instances/:instanceId/setup', async (request, reply) => {
      let instanceId = 'unknown'
      let authorized = false
      try {
        guard.assertMutation(request, 'setup-reset')
        authorized = true
        instanceId = requireInstanceId(request)
        audit(request, 'setup-reset', instanceId, 'started')
        const instance = await registry.resetSetup(instanceId)
        audit(request, 'setup-reset', instanceId, 'succeeded')
        reply.send({ instance } satisfies AgentProviderSnapshotResponse)
      } catch (error) {
        if (authorized) audit(request, 'setup-reset', instanceId, 'failed')
        sendError(reply, error)
      }
    })

    server.post('/api/agent-provider-instances/:instanceId/login-attempts', async (request, reply) => {
      let instanceId = 'unknown'
      let authorized = false
      try {
        guard.assertMutation(request, 'login-start')
        authorized = true
        instanceId = requireInstanceId(request)
        audit(request, 'login-start', instanceId, 'started')
        const attempt = loginService.create(instanceId)
        audit(request, 'login-start', instanceId, 'succeeded')
        reply.code(201).send({ attempt } satisfies AgentProviderLoginAttemptResponse)
      } catch (error) {
        if (authorized) audit(request, 'login-start', instanceId, 'failed')
        sendError(reply, error)
      }
    })

    server.get(
      '/api/agent-provider-instances/:instanceId/login-attempts/:attemptId',
      async (request, reply) => {
        try {
          guard.assertAuthorizedRead(request)
          const instanceId = requireInstanceId(request)
          const attemptId = requireAttemptId(request)
          reply.header('Cache-Control', 'no-store')
          reply.send({
            attempt: loginService.get(instanceId, attemptId)
          } satisfies AgentProviderLoginAttemptResponse)
        } catch (error) {
          sendError(reply, error)
        }
      }
    )

    server.post(
      '/api/agent-provider-instances/:instanceId/login-attempts/:attemptId/cancel',
      async (request, reply) => {
        let instanceId = 'unknown'
        let authorized = false
        try {
          guard.assertMutation(request, 'login-cancel')
          authorized = true
          instanceId = requireInstanceId(request)
          const attemptId = requireAttemptId(request)
          audit(request, 'login-cancel', instanceId, 'started')
          const attempt = await loginService.cancel(instanceId, attemptId)
          audit(request, 'login-cancel', instanceId, 'succeeded')
          reply.send({ attempt } satisfies AgentProviderLoginAttemptResponse)
        } catch (error) {
          if (authorized) audit(request, 'login-cancel', instanceId, 'failed')
          sendError(reply, error)
        }
      }
    )
  }
}

export const agentProvidersRoute = createAgentProvidersRoute()
