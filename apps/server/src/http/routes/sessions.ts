import { type FastifyPluginAsync, type FastifyReply } from 'fastify'
import type {
  AgentProvider,
  AgentRuntimeMode,
  ApiErrorResponse,
  CreateAgentSessionRequest,
  CreateAgentSessionResponse
} from '@open-science/contracts'

import { agentSessionService } from '../../services'

const agentProviders: AgentProvider[] = ['codex', 'claude']
const runtimeModes: AgentRuntimeMode[] = ['full_access', 'default']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isAgentProvider(value: unknown): value is AgentProvider {
  return typeof value === 'string' && agentProviders.includes(value as AgentProvider)
}

function isRuntimeMode(value: unknown): value is AgentRuntimeMode {
  return typeof value === 'string' && runtimeModes.includes(value as AgentRuntimeMode)
}

function sendBadRequest(reply: FastifyReply, message: string) {
  return reply.code(400).send({
    error: {
      code: 'bad_request',
      message
    }
  } satisfies ApiErrorResponse)
}

function parseCreateSessionRequest(body: unknown): CreateAgentSessionRequest | ApiErrorResponse['error'] {
  if (!isRecord(body)) {
    return {
      code: 'bad_request',
      message: 'Request body must be a JSON object.'
    }
  }

  if (!isAgentProvider(body.provider)) {
    return {
      code: 'bad_request',
      message: 'provider must be either "codex" or "claude".'
    }
  }

  if (!isNonEmptyString(body.cwd)) {
    return {
      code: 'bad_request',
      message: 'cwd is required.'
    }
  }

  if (!isNonEmptyString(body.initialMessage)) {
    return {
      code: 'bad_request',
      message: 'initialMessage is required.'
    }
  }

  if (body.runtimeMode !== undefined && body.runtimeMode !== null && !isRuntimeMode(body.runtimeMode)) {
    return {
      code: 'bad_request',
      message: 'runtimeMode must be either "full_access" or "default".'
    }
  }

  if (body.model !== undefined && body.model !== null && typeof body.model !== 'string') {
    return {
      code: 'bad_request',
      message: 'model must be a string when provided.'
    }
  }

  return {
    provider: body.provider,
    cwd: body.cwd.trim(),
    initialMessage: body.initialMessage,
    model: body.model ?? null,
    runtimeMode: body.runtimeMode ?? 'full_access'
  }
}

function isParseError(value: CreateAgentSessionRequest | ApiErrorResponse['error']): value is ApiErrorResponse['error'] {
  return 'code' in value
}

export const sessionsRoute: FastifyPluginAsync = async (server) => {
  server.get('/api/sessions', async (_request, reply) => {
    reply.send({
      sessions: agentSessionService.listVisibleSessions()
    })
  })

  server.post('/api/sessions', async (request, reply) => {
    const parsed = parseCreateSessionRequest(request.body)
    if (isParseError(parsed)) {
      return sendBadRequest(reply, parsed.message)
    }

    const response = agentSessionService.createPendingSessionForInitialMessage(parsed)
    reply.code(202).send(response satisfies CreateAgentSessionResponse)
  })

  server.get('/api/sessions/:sessionId', async (request, reply) => {
    const params = request.params as { sessionId?: string }
    if (!isNonEmptyString(params.sessionId)) {
      return sendBadRequest(reply, 'sessionId is required.')
    }

    const detail = agentSessionService.getSessionDetail(params.sessionId)
    if (!detail) {
      return reply.code(404).send({
        error: {
          code: 'not_found',
          message: 'Session was not found.'
        }
      } satisfies ApiErrorResponse)
    }

    return reply.send(detail)
  })
}
