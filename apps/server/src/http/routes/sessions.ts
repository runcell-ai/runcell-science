import { type FastifyPluginAsync, type FastifyReply } from 'fastify'
import type {
  AgentProvider,
  AgentRuntimeMode,
  ApiErrorResponse,
  AgentSessionWorktreeDiffResponse,
  AgentSessionWorktreeDiffStatusResponse,
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

import { RuntimeProviderError, runtimeRegistry, sessionEventBus } from '../../runtime'
import { AgentSessionServiceError, agentSessionService } from '../../services'
import { currentWorktreeDiff, isGitRepository } from '../../services/git-worktree-diff-service'

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

  if (error instanceof RuntimeProviderError) {
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
    const initialTurn = response.detail.turns[0]
    const initialMessage = response.detail.messages[0]

    if (!initialTurn || !initialMessage) {
      agentSessionService.discardPendingActivationSession(response.sessionId)
      return reply.code(500).send({
        error: {
          code: 'session_projection_failed',
          message: 'Initial session projection is incomplete.'
        }
      } satisfies ApiErrorResponse)
    }

    try {
      agentSessionService.captureTurnCheckpointBaseline({
        session: response.detail.session,
        turn: initialTurn
      })
      await runtimeRegistry.startInitialTurn({
        session: response.detail.session,
        turn: initialTurn,
        message: initialMessage
      })
      return reply.code(202).send(response satisfies CreateAgentSessionResponse)
    } catch (error) {
      agentSessionService.discardPendingActivationSession(response.sessionId)
      return sendServiceError(reply, error)
    }
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

  server.get('/api/sessions/:sessionId/worktree-diff/status', async (request, reply) => {
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

    return reply.send({
      isGitRepository: await isGitRepository(detail.session.cwd)
    } satisfies AgentSessionWorktreeDiffStatusResponse)
  })

  server.get('/api/sessions/:sessionId/worktree-diff', async (request, reply) => {
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

    const isRepository = await isGitRepository(detail.session.cwd)
    return reply.send({
      isGitRepository: isRepository,
      unifiedDiff: isRepository ? await currentWorktreeDiff(detail.session.cwd) : null,
      generatedAt: isRepository ? new Date().toISOString() : null
    } satisfies AgentSessionWorktreeDiffResponse)
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
      const detail = agentSessionService.getSessionDetail(params.sessionId)
      const userMessage = detail?.messages.find((message) => message.turnId === turn.id && message.role === 'user')
      if (!detail || !userMessage) {
        throw new AgentSessionServiceError('not_found', 'Session turn projection was not found.', 404)
      }

      agentSessionService.captureTurnCheckpointBaseline({
        session: detail.session,
        turn
      })

      await runtimeRegistry.startTurn({
        session: detail.session,
        turn,
        message: userMessage
      })

      return reply.code(202).send({
        turn
      } satisfies CreateAgentTurnResponse)
    } catch (error) {
      if (error instanceof RuntimeProviderError) {
        const runningTurn = agentSessionService
          .getSessionDetail(params.sessionId)
          ?.turns.find((entry) => entry.status === 'running')
        if (runningTurn) {
          agentSessionService.failTurn(params.sessionId, runningTurn.id, error.message)
        }
      }
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
      const detail = agentSessionService.getSessionDetail(params.sessionId)
      if (!detail) {
        return reply.code(404).send({
          error: {
            code: 'not_found',
            message: 'Session was not found.'
          }
        } satisfies ApiErrorResponse)
      }

      await runtimeRegistry.resolveRequest(detail.session, params.requestId, parsed)
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
      const detail = agentSessionService.getSessionDetail(params.sessionId)
      if (!detail) {
        return reply.code(404).send({
          error: {
            code: 'not_found',
            message: 'Session was not found.'
          }
        } satisfies ApiErrorResponse)
      }

      await runtimeRegistry.interrupt({
        session: detail.session
      })
      const result = agentSessionService.interruptRunningTurn(params.sessionId)
      return reply.send(result satisfies InterruptAgentSessionResponse)
    } catch (error) {
      return sendServiceError(reply, error)
    }
  })
}
