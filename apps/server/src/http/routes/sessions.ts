import { type FastifyPluginAsync, type FastifyReply } from 'fastify'
import type {
  AgentProvider,
  AgentRuntimeMode,
  ApiErrorResponse,
  CreateAgentTurnRequest,
  CreateAgentTurnResponse,
  CreateAgentSessionRequest,
  CreateAgentSessionResponse,
  InterruptAgentSessionResponse,
  ListAgentSessionsResponse,
  ResolveAgentRequestRequest,
  ResolveAgentRequestResponse,
  RuntimeSseEvent
} from '@open-science/contracts'

import { sessionEventBus } from '../../runtime'
import { AgentSessionServiceError, agentSessionService } from '../../services'

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

function sendServiceError(reply: FastifyReply, error: unknown) {
  if (error instanceof AgentSessionServiceError) {
    return reply.code(error.httpStatus).send({
      error: {
        code: error.code,
        message: error.message
      }
    } satisfies ApiErrorResponse)
  }

  throw error
}

function sendSseEvent(reply: FastifyReply, event: RuntimeSseEvent): void {
  reply.raw.write(`id: ${event.id}\n`)
  reply.raw.write(`event: ${event.type}\n`)
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
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

function parseCreateTurnRequest(body: unknown): CreateAgentTurnRequest | ApiErrorResponse['error'] {
  if (!isRecord(body)) {
    return {
      code: 'bad_request',
      message: 'Request body must be a JSON object.'
    }
  }

  if (!isNonEmptyString(body.message)) {
    return {
      code: 'bad_request',
      message: 'message is required.'
    }
  }

  return {
    message: body.message
  }
}

function parseResolveRequest(body: unknown): ResolveAgentRequestRequest | ApiErrorResponse['error'] {
  if (!isRecord(body)) {
    return {
      code: 'bad_request',
      message: 'Request body must be a JSON object.'
    }
  }

  if (body.decision !== 'allow' && body.decision !== 'deny' && body.decision !== 'answer') {
    return {
      code: 'bad_request',
      message: 'decision must be "allow", "deny", or "answer".'
    }
  }

  if (body.answer !== undefined && typeof body.answer !== 'string') {
    return {
      code: 'bad_request',
      message: 'answer must be a string when provided.'
    }
  }

  return {
    decision: body.decision,
    ...(body.answer !== undefined ? { answer: body.answer } : {})
  }
}

export const sessionsRoute: FastifyPluginAsync = async (server) => {
  server.get('/api/sessions', async (_request, reply) => {
    reply.send({
      sessions: agentSessionService.listVisibleSessions()
    } satisfies ListAgentSessionsResponse)
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

  server.post('/api/sessions/:sessionId/turns', async (request, reply) => {
    const params = request.params as { sessionId?: string }
    if (!isNonEmptyString(params.sessionId)) {
      return sendBadRequest(reply, 'sessionId is required.')
    }

    const parsed = parseCreateTurnRequest(request.body)
    if ('code' in parsed) {
      return sendBadRequest(reply, parsed.message)
    }

    try {
      const turn = agentSessionService.startFollowupTurn({
        sessionId: params.sessionId,
        message: parsed.message
      })
      return reply.code(202).send({
        turn
      } satisfies CreateAgentTurnResponse)
    } catch (error) {
      return sendServiceError(reply, error)
    }
  })

  server.get('/api/sessions/:sessionId/events', async (request, reply) => {
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

    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })

    const unsubscribe = sessionEventBus.subscribe(params.sessionId, (event) => {
      if (!reply.raw.writableEnded) {
        sendSseEvent(reply, event)
      }
    })

    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) {
        reply.raw.write(': heartbeat\n\n')
      }
    }, 15_000)

    sendSseEvent(reply, {
      id: `snapshot_${detail.session.id}`,
      type: 'session.snapshot',
      sessionId: detail.session.id,
      createdAt: new Date().toISOString(),
      detail
    })

    request.raw.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
  })

  server.post('/api/sessions/:sessionId/requests/:requestId/resolve', async (request, reply) => {
    const params = request.params as { sessionId?: string; requestId?: string }
    if (!isNonEmptyString(params.sessionId)) {
      return sendBadRequest(reply, 'sessionId is required.')
    }
    if (!isNonEmptyString(params.requestId)) {
      return sendBadRequest(reply, 'requestId is required.')
    }

    const parsed = parseResolveRequest(request.body)
    if ('code' in parsed) {
      return sendBadRequest(reply, parsed.message)
    }

    try {
      const resolved = agentSessionService.resolvePendingRequest({
        sessionId: params.sessionId,
        requestId: params.requestId,
        responseJson: parsed
      })
      return reply.send({
        request: resolved
      } satisfies ResolveAgentRequestResponse)
    } catch (error) {
      return sendServiceError(reply, error)
    }
  })

  server.post('/api/sessions/:sessionId/interrupt', async (request, reply) => {
    const params = request.params as { sessionId?: string }
    if (!isNonEmptyString(params.sessionId)) {
      return sendBadRequest(reply, 'sessionId is required.')
    }

    try {
      const result = agentSessionService.interruptRunningTurn(params.sessionId)
      return reply.send(result satisfies InterruptAgentSessionResponse)
    } catch (error) {
      return sendServiceError(reply, error)
    }
  })
}
