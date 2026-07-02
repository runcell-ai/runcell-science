import fs from 'node:fs'
import path from 'node:path'

import { type FastifyPluginAsync, type FastifyReply } from 'fastify'
import type {
  AgentArtifact,
  AgentArtifactKind,
  AgentArtifactMarkdownContentResponse,
  AgentProvider,
  AgentRuntimeMode,
  ApiErrorResponse,
  AgentSessionWorktreeDiffResponse,
  AgentSessionWorktreeDiffStatusResponse,
  CreateAgentArtifactRequest,
  CreateAgentArtifactResponse,
  CreateAgentTurnRequest,
  CreateAgentTurnResponse,
  CreateAgentSessionRequest,
  CreateAgentSessionResponse,
  InterruptAgentSessionResponse,
  ListAgentSessionsResponse,
  ListWorkspaceFilesResponse,
  ResolveAgentRequestRequest,
  ResolveAgentRequestResponse,
  RuntimeSseEvent
} from '@open-science/contracts'

import { RuntimeProviderError, runtimeRegistry, sessionEventBus } from '../../runtime'
import { AgentSessionServiceError, agentSessionService } from '../../services'
import { inferArtifactKindFromPath } from '../../services/agent-session-service'
import { currentWorktreeDiff, isGitRepository } from '../../services/git-worktree-diff-service'
import { classifyWorkspaceFile, listWorkspaceFiles } from '../../services/workspace-files-service'

const agentProviders: AgentProvider[] = ['codex', 'claude']
const runtimeModes: AgentRuntimeMode[] = ['full_access', 'default']
const localArtifactKinds: Exclude<AgentArtifactKind, 'url'>[] = ['image', 'pdf', 'markdown', 'html']

const artifactContentTypes: Record<string, string> = {
  '.apng': 'image/apng',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.markdown': 'text/markdown; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.mdown': 'text/markdown; charset=utf-8',
  '.mkd': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
}

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

function isLocalArtifactKind(value: unknown): value is Exclude<AgentArtifactKind, 'url'> {
  return typeof value === 'string' && localArtifactKinds.includes(value as Exclude<AgentArtifactKind, 'url'>)
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function sendBadRequest(reply: FastifyReply, message: string) {
  return reply.code(400).send({
    error: {
      code: 'bad_request',
      message
    }
  } satisfies ApiErrorResponse)
}

function sendApiError(reply: FastifyReply, error: ApiErrorResponse['error']) {
  return reply.code(error.code === 'not_found' ? 404 : 400).send({
    error
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

function isInsideDirectory(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative === '' || (relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function normalizeArtifactPath(cwd: string, candidate: string): string | ApiErrorResponse['error'] {
  if (candidate.includes('\0')) {
    return {
      code: 'bad_request',
      message: 'path must not contain null bytes.'
    }
  }

  let cwdReal: string
  let fileReal: string
  try {
    cwdReal = fs.realpathSync(cwd)
    fileReal = fs.realpathSync(path.resolve(cwdReal, candidate))
  } catch {
    return {
      code: 'bad_request',
      message: 'path must reference an existing file inside the session cwd.'
    }
  }

  if (!isInsideDirectory(cwdReal, fileReal)) {
    return {
      code: 'bad_request',
      message: 'path must stay inside the session cwd.'
    }
  }

  const stat = fs.statSync(fileReal)
  if (!stat.isFile()) {
    return {
      code: 'bad_request',
      message: 'path must reference a file.'
    }
  }

  return path.relative(cwdReal, fileReal).split(path.sep).join('/')
}

function contentTypeForPath(filePath: string): string {
  return artifactContentTypes[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

/** Like contentTypeForPath, but serves recognized text/data files as UTF-8
 * text so the browser (and the artifacts panel) can display them inline. */
function workspaceContentTypeForPath(filePath: string): string {
  const known = artifactContentTypes[path.extname(filePath).toLowerCase()]
  if (known) {
    return known
  }
  return classifyWorkspaceFile(filePath) === 'text'
    ? 'text/plain; charset=utf-8'
    : 'application/octet-stream'
}

/** Resolve a cwd-relative workspace path to an absolute real path, rejecting
 * anything that escapes the session directory. */
function resolveWorkspaceFilePath(cwd: string, relativePath: string): string | ApiErrorResponse['error'] {
  if (!isNonEmptyString(relativePath)) {
    return { code: 'bad_request', message: 'path query parameter is required.' }
  }
  if (relativePath.includes('\0') || path.isAbsolute(relativePath)) {
    return { code: 'bad_request', message: 'path must be relative to the session directory.' }
  }

  try {
    const cwdReal = fs.realpathSync(cwd)
    const targetReal = fs.realpathSync(path.resolve(cwdReal, relativePath))
    if (!isInsideDirectory(cwdReal, targetReal)) {
      return { code: 'bad_request', message: 'path must stay inside the session directory.' }
    }
    if (!fs.statSync(targetReal).isFile()) {
      return { code: 'bad_request', message: 'path must reference a file.' }
    }
    return targetReal
  } catch {
    return { code: 'not_found', message: 'File was not found.' }
  }
}

function safeFilename(filePath: string): string {
  return path.basename(filePath).replace(/[^\w.\- ]+/g, '_') || 'artifact'
}

function resolveArtifactAssetPath(
  artifact: AgentArtifact,
  cwd: string,
  resourcePath: string
): string | ApiErrorResponse['error'] {
  if (artifact.source !== 'file' || !artifact.path) {
    return {
      code: 'bad_request',
      message: 'Artifact is not backed by a local file.'
    }
  }

  if (resourcePath.includes('\0') || path.isAbsolute(resourcePath)) {
    return {
      code: 'bad_request',
      message: 'resource path must be relative.'
    }
  }

  try {
    const cwdReal = fs.realpathSync(cwd)
    const artifactReal = fs.realpathSync(path.resolve(cwdReal, artifact.path))
    const baseDirReal = fs.realpathSync(path.dirname(artifactReal))
    const targetCandidate = resourcePath ? path.resolve(baseDirReal, resourcePath) : artifactReal
    const targetReal = fs.realpathSync(targetCandidate)

    if (!isInsideDirectory(cwdReal, targetReal) || !isInsideDirectory(baseDirReal, targetReal)) {
      return {
        code: 'bad_request',
        message: 'resource path must stay inside the artifact directory.'
      }
    }

    if (!fs.statSync(targetReal).isFile()) {
      return {
        code: 'bad_request',
        message: 'resource path must reference a file.'
      }
    }

    return targetReal
  } catch {
    return {
      code: 'not_found',
      message: 'Artifact file was not found.'
    }
  }
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

function parseCreateArtifactRequest(body: unknown): CreateAgentArtifactRequest | ApiErrorResponse['error'] {
  if (!isRecord(body)) {
    return {
      code: 'bad_request',
      message: 'Request body must be a JSON object.'
    }
  }

  if (isNonEmptyString(body.url)) {
    if (body.path !== undefined) {
      return {
        code: 'bad_request',
        message: 'Provide either url or path, not both.'
      }
    }
    if (body.kind !== undefined && body.kind !== null && body.kind !== 'url') {
      return {
        code: 'bad_request',
        message: 'URL artifacts must use kind "url".'
      }
    }
    if (!isHttpUrl(body.url.trim())) {
      return {
        code: 'bad_request',
        message: 'url must be an http or https URL.'
      }
    }
    return {
      kind: 'url',
      url: body.url.trim(),
      title: typeof body.title === 'string' ? body.title : null,
      turnId: typeof body.turnId === 'string' ? body.turnId : null,
      messageId: typeof body.messageId === 'string' ? body.messageId : null
    }
  }

  if (!isNonEmptyString(body.path)) {
    return {
      code: 'bad_request',
      message: 'path or url is required.'
    }
  }

  if (body.kind !== undefined && body.kind !== null && !isLocalArtifactKind(body.kind)) {
    return {
      code: 'bad_request',
      message: 'kind must be image, pdf, markdown, html, or url.'
    }
  }

  return {
    kind: isLocalArtifactKind(body.kind) ? body.kind : undefined,
    path: body.path.trim(),
    title: typeof body.title === 'string' ? body.title : null,
    turnId: typeof body.turnId === 'string' ? body.turnId : null,
    messageId: typeof body.messageId === 'string' ? body.messageId : null
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

  server.post('/api/sessions/:sessionId/artifacts', async (request, reply) => {
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

    const parsed = parseCreateArtifactRequest(request.body)
    if ('code' in parsed) {
      return sendBadRequest(reply, parsed.message)
    }

    try {
      if ('url' in parsed) {
        const artifact = agentSessionService.createArtifact({
          sessionId: params.sessionId,
          turnId: parsed.turnId ?? null,
          messageId: parsed.messageId ?? null,
          kind: 'url',
          source: 'url',
          url: parsed.url,
          title: parsed.title ?? parsed.url
        })
        return reply.code(201).send({ artifact } satisfies CreateAgentArtifactResponse)
      }

      const normalizedPath = normalizeArtifactPath(detail.session.cwd, parsed.path)
      if (typeof normalizedPath !== 'string') {
        return sendApiError(reply, normalizedPath)
      }

      const kind = parsed.kind ?? inferArtifactKindFromPath(normalizedPath)
      if (!kind) {
        return sendBadRequest(reply, 'path must be an image, PDF, Markdown, or HTML file.')
      }

      const artifact = agentSessionService.createArtifact({
        sessionId: params.sessionId,
        turnId: parsed.turnId ?? null,
        messageId: parsed.messageId ?? null,
        kind,
        source: 'file',
        path: normalizedPath,
        title: parsed.title ?? path.basename(normalizedPath)
      })
      return reply.code(201).send({ artifact } satisfies CreateAgentArtifactResponse)
    } catch (error) {
      return sendServiceError(reply, error)
    }
  })

  server.get('/api/artifacts/:artifactId/content', async (request, reply) => {
    const params = request.params as { artifactId?: string }
    if (!isNonEmptyString(params.artifactId)) {
      return sendBadRequest(reply, 'artifactId is required.')
    }

    const artifact = agentSessionService.getArtifact(params.artifactId)
    if (!artifact) {
      return reply.code(404).send({
        error: {
          code: 'not_found',
          message: 'Artifact was not found.'
        }
      } satisfies ApiErrorResponse)
    }

    if (artifact.kind !== 'markdown') {
      return sendBadRequest(reply, 'Only Markdown artifacts expose text content.')
    }

    const detail = agentSessionService.getSessionDetail(artifact.sessionId)
    if (!detail) {
      return reply.code(404).send({
        error: {
          code: 'not_found',
          message: 'Session was not found.'
        }
      } satisfies ApiErrorResponse)
    }

    const resolved = resolveArtifactAssetPath(artifact, detail.session.cwd, '')
    if (typeof resolved !== 'string') {
      return sendApiError(reply, resolved)
    }

    const content = await fs.promises.readFile(resolved, 'utf8')
    return reply.send({
      artifact,
      content
    } satisfies AgentArtifactMarkdownContentResponse)
  })

  async function sendArtifactAsset(requestParams: { artifactId?: string; '*': string | undefined }, reply: FastifyReply) {
    if (!isNonEmptyString(requestParams.artifactId)) {
      return sendBadRequest(reply, 'artifactId is required.')
    }

    const artifact = agentSessionService.getArtifact(requestParams.artifactId)
    if (!artifact) {
      return reply.code(404).send({
        error: {
          code: 'not_found',
          message: 'Artifact was not found.'
        }
      } satisfies ApiErrorResponse)
    }

    const detail = agentSessionService.getSessionDetail(artifact.sessionId)
    if (!detail) {
      return reply.code(404).send({
        error: {
          code: 'not_found',
          message: 'Session was not found.'
        }
      } satisfies ApiErrorResponse)
    }

    const resolved = resolveArtifactAssetPath(artifact, detail.session.cwd, requestParams['*'] ?? '')
    if (typeof resolved !== 'string') {
      return sendApiError(reply, resolved)
    }

    reply.header('Content-Type', contentTypeForPath(resolved))
    reply.header('Content-Disposition', `inline; filename="${safeFilename(resolved)}"`)
    reply.header('Cache-Control', 'no-store')
    return reply.send(fs.createReadStream(resolved))
  }

  server.get('/api/artifacts/:artifactId/asset', async (request, reply) =>
    sendArtifactAsset(request.params as { artifactId?: string; '*': string | undefined }, reply)
  )

  server.get('/api/artifacts/:artifactId/asset/*', async (request, reply) =>
    sendArtifactAsset(request.params as { artifactId?: string; '*': string | undefined }, reply)
  )

  server.get('/api/sessions/:sessionId/files', async (request, reply) => {
    const params = request.params as { sessionId?: string }
    if (!isNonEmptyString(params.sessionId)) {
      return sendBadRequest(reply, 'sessionId is required.')
    }

    const detail = agentSessionService.getSessionDetail(params.sessionId)
    if (!detail) {
      return reply.code(404).send({
        error: { code: 'not_found', message: 'Session was not found.' }
      } satisfies ApiErrorResponse)
    }

    const result = listWorkspaceFiles(detail.session.cwd)
    return reply.send({
      root: result.root,
      isDirectory: result.isDirectory,
      files: result.files,
      truncated: result.truncated
    } satisfies ListWorkspaceFilesResponse)
  })

  server.get('/api/sessions/:sessionId/files/raw', async (request, reply) => {
    const params = request.params as { sessionId?: string }
    if (!isNonEmptyString(params.sessionId)) {
      return sendBadRequest(reply, 'sessionId is required.')
    }

    const detail = agentSessionService.getSessionDetail(params.sessionId)
    if (!detail) {
      return reply.code(404).send({
        error: { code: 'not_found', message: 'Session was not found.' }
      } satisfies ApiErrorResponse)
    }

    const query = request.query as { path?: string }
    const resolved = resolveWorkspaceFilePath(detail.session.cwd, query.path ?? '')
    if (typeof resolved !== 'string') {
      return sendApiError(reply, resolved)
    }

    reply.header('Content-Type', workspaceContentTypeForPath(resolved))
    reply.header('Content-Disposition', `inline; filename="${safeFilename(resolved)}"`)
    reply.header('Cache-Control', 'no-store')
    return reply.send(fs.createReadStream(resolved))
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

  server.patch('/api/sessions/:sessionId/connectors', async (request, reply) => {
    const params = request.params as { sessionId?: string }
    const body = request.body as { disabledServers?: unknown } | undefined
    if (!isNonEmptyString(params.sessionId) || !Array.isArray(body?.disabledServers)) {
      return sendBadRequest(reply, 'sessionId and disabledServers array are required.')
    }

    const disabledServers = body.disabledServers.filter((entry): entry is string => typeof entry === 'string')

    try {
      const detail = agentSessionService.updateDisabledMcpServers(params.sessionId, disabledServers)
      // Codex keeps a long-lived app-server per session whose overrides are
      // set at spawn; drop it so the next turn respawns and resumes the
      // thread with the new selection. Claude injects per turn, no reset.
      if (detail.session.provider === 'codex') {
        runtimeRegistry.resetSession(detail.session)
      }
      return reply.send(detail)
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
