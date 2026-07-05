import fs from 'node:fs'
import path from 'node:path'

import { type FastifyPluginAsync, type FastifyReply } from 'fastify'
import type {
  ApiErrorResponse,
  AgentSessionSummary,
  JupyterInstallIpykernelResponse,
  JupyterPythonEnvStatus,
  JupyterServerConnectionResponse,
  JupyterServerStatusResponse,
  NotebookExecutionDetail
} from '@open-science/contracts'

import { sessionEventBus } from '../../runtime'
import { agentSessionService, jupyterServerManager } from '../../services'
import { JupyterEnvMissingError, JupyterRuntimeError } from '../../services/jupyter-server-manager'

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function sendBadRequest(reply: FastifyReply, message: string) {
  return reply.code(400).send({
    error: {
      code: 'bad_request',
      message
    }
  } satisfies ApiErrorResponse)
}

function sendSessionNotFound(reply: FastifyReply) {
  return reply.code(404).send({
    error: {
      code: 'not_found',
      message: 'Session was not found.'
    }
  } satisfies ApiErrorResponse)
}

function sendWorkspaceNotFound(reply: FastifyReply) {
  return reply.code(404).send({
    error: {
      code: 'not_found',
      message: 'Workspace was not found.'
    }
  } satisfies ApiErrorResponse)
}

function missingEnvMessage(status: JupyterPythonEnvStatus): string {
  if (!status.pythonPath) {
    return 'No Python interpreter was found for this workspace. Create a .venv or install python3.'
  }
  return `Python interpreter ${status.pythonPath} is missing ipykernel.`
}

export function knownWorkspaceRealpathForCwd(
  cwd: string,
  sessions: Pick<AgentSessionSummary, 'cwd'>[]
): string | null {
  let requestedReal: string
  try {
    requestedReal = fs.realpathSync(cwd)
  } catch {
    return null
  }

  for (const session of sessions) {
    try {
      if (fs.realpathSync(session.cwd) === requestedReal) {
        return requestedReal
      }
    } catch {
      // Ignore stale session cwd values.
    }
  }

  return null
}

function validateAbsoluteCwd(cwd: unknown): string | ApiErrorResponse['error'] {
  if (!isNonEmptyString(cwd)) {
    return {
      code: 'bad_request',
      message: 'cwd is required.'
    }
  }
  if (cwd.includes('\0') || !path.isAbsolute(cwd)) {
    return {
      code: 'bad_request',
      message: 'cwd must be an absolute path.'
    }
  }
  return cwd
}

function resolveKnownWorkspaceCwd(cwd: unknown): string | ApiErrorResponse['error'] | null {
  const validated = validateAbsoluteCwd(cwd)
  if (typeof validated !== 'string') {
    return validated
  }

  return knownWorkspaceRealpathForCwd(validated, agentSessionService.listVisibleSessions())
}

function validateWorkspaceNotebookPath(notebook: unknown): string | ApiErrorResponse['error'] {
  if (
    !isNonEmptyString(notebook) ||
    notebook.includes('\0') ||
    path.isAbsolute(notebook) ||
    notebook.split('/').includes('..')
  ) {
    return {
      code: 'bad_request',
      message: 'notebook must be a workspace-relative path.'
    }
  }
  return notebook
}

function validateNotebookExecutionDetail(body: Record<string, unknown>, notebook: string): NotebookExecutionDetail | ApiErrorResponse['error'] {
  const mode = body.mode
  if (mode !== 'exec-cell' && mode !== 'exec-code') {
    return {
      code: 'bad_request',
      message: 'mode must be exec-cell or exec-code.'
    }
  }

  const status = body.status
  if (status !== 'ok' && status !== 'error' && status !== 'timeout') {
    return {
      code: 'bad_request',
      message: 'status must be ok, error, or timeout.'
    }
  }

  if (!Array.isArray(body.outputs) || body.outputs.length > 25) {
    return {
      code: 'bad_request',
      message: 'outputs must be an array with at most 25 entries.'
    }
  }

  if (body.cellId !== null && body.cellId !== undefined && typeof body.cellId !== 'string') {
    return {
      code: 'bad_request',
      message: 'cellId must be a string or null.'
    }
  }
  if (body.executionCount !== null && body.executionCount !== undefined && typeof body.executionCount !== 'number') {
    return {
      code: 'bad_request',
      message: 'executionCount must be a number or null.'
    }
  }
  if (typeof body.durationMs !== 'number' || !Number.isFinite(body.durationMs) || body.durationMs < 0) {
    return {
      code: 'bad_request',
      message: 'durationMs must be a non-negative number.'
    }
  }
  if (typeof body.truncated !== 'boolean') {
    return {
      code: 'bad_request',
      message: 'truncated must be a boolean.'
    }
  }

  return {
    notebook,
    mode,
    cellId: typeof body.cellId === 'string' ? body.cellId : null,
    status,
    executionCount: typeof body.executionCount === 'number' ? body.executionCount : null,
    durationMs: body.durationMs,
    outputs: body.outputs.filter((output): output is Record<string, unknown> => (
      typeof output === 'object' && output !== null && !Array.isArray(output)
    )),
    truncated: body.truncated
  }
}

export const jupyterRoute: FastifyPluginAsync = async (server) => {
  jupyterServerManager.setLogger(server.log)

  server.get('/api/sessions/:sessionId/jupyter', async (request, reply) => {
    const params = request.params as { sessionId?: string }
    if (!isNonEmptyString(params.sessionId)) {
      return sendBadRequest(reply, 'sessionId is required.')
    }

    const detail = agentSessionService.getSessionDetail(params.sessionId)
    if (!detail) {
      return sendSessionNotFound(reply)
    }

    return reply.send((await jupyterServerManager.status(detail.session.cwd)) satisfies JupyterServerStatusResponse)
  })

  server.post('/api/sessions/:sessionId/jupyter', async (request, reply) => {
    const params = request.params as { sessionId?: string }
    if (!isNonEmptyString(params.sessionId)) {
      return sendBadRequest(reply, 'sessionId is required.')
    }

    const detail = agentSessionService.getSessionDetail(params.sessionId)
    if (!detail) {
      return sendSessionNotFound(reply)
    }

    try {
      return reply.send(
        (await jupyterServerManager.ensure(detail.session.cwd)) satisfies JupyterServerConnectionResponse
      )
    } catch (error) {
      if (error instanceof JupyterEnvMissingError) {
        return reply.code(409).send({
          error: {
            code: 'jupyter_env_missing',
            message: missingEnvMessage(error.status),
            details: {
              python: error.status
            }
          }
        } satisfies ApiErrorResponse)
      }

      request.log.warn({ error }, 'Failed to start Jupyter server.')
      return reply.code(502).send({
        error: {
          code: 'jupyter_start_failed',
          // JupyterRuntimeError messages are user-actionable (provisioning /
          // JUPYTER_SERVER_PYTHON problems) and never contain tokens.
          message:
            error instanceof JupyterRuntimeError ? error.message : 'Jupyter server failed to start for this session.'
        }
      } satisfies ApiErrorResponse)
    }
  })

  server.get('/api/jupyter/workspace', async (request, reply) => {
    const query = request.query as { cwd?: string }
    const cwd = resolveKnownWorkspaceCwd(query.cwd)
    if (cwd === null) {
      return sendWorkspaceNotFound(reply)
    }
    if (typeof cwd !== 'string') {
      return reply.code(cwd.code === 'bad_request' ? 400 : 404).send({ error: cwd } satisfies ApiErrorResponse)
    }

    return reply.send((await jupyterServerManager.status(cwd)) satisfies JupyterServerStatusResponse)
  })

  server.post('/api/jupyter/workspace', async (request, reply) => {
    const body = request.body as { cwd?: string } | null
    const cwd = resolveKnownWorkspaceCwd(body?.cwd)
    if (cwd === null) {
      return sendWorkspaceNotFound(reply)
    }
    if (typeof cwd !== 'string') {
      return reply.code(cwd.code === 'bad_request' ? 400 : 404).send({ error: cwd } satisfies ApiErrorResponse)
    }

    try {
      return reply.send((await jupyterServerManager.ensure(cwd)) satisfies JupyterServerConnectionResponse)
    } catch (error) {
      if (error instanceof JupyterEnvMissingError) {
        return reply.code(409).send({
          error: {
            code: 'jupyter_env_missing',
            message: missingEnvMessage(error.status),
            details: {
              python: error.status
            }
          }
        } satisfies ApiErrorResponse)
      }

      request.log.warn({ error }, 'Failed to start Jupyter server.')
      return reply.code(502).send({
        error: {
          code: 'jupyter_start_failed',
          message:
            error instanceof JupyterRuntimeError ? error.message : 'Jupyter server failed to start for this workspace.'
        }
      } satisfies ApiErrorResponse)
    }
  })

  // One-click fix for the env-missing panel: installs ipykernel into the
  // workspace's project python (uv when available, pip fallback).
  server.post('/api/sessions/:sessionId/jupyter/ipykernel', async (request, reply) => {
    const params = request.params as { sessionId?: string }
    if (!isNonEmptyString(params.sessionId)) {
      return sendBadRequest(reply, 'sessionId is required.')
    }

    const detail = agentSessionService.getSessionDetail(params.sessionId)
    if (!detail) {
      return sendSessionNotFound(reply)
    }

    try {
      const python = await jupyterServerManager.installIpykernel(detail.session.cwd)
      return reply.send({ ok: python.hasIpykernel, python } satisfies JupyterInstallIpykernelResponse)
    } catch (error) {
      if (error instanceof JupyterEnvMissingError) {
        return reply.code(409).send({
          error: {
            code: 'jupyter_env_missing',
            message: missingEnvMessage(error.status),
            details: { python: error.status }
          }
        } satisfies ApiErrorResponse)
      }
      request.log.warn({ error }, 'Failed to install ipykernel.')
      return reply.code(502).send({
        error: {
          code: 'jupyter_install_failed',
          message: error instanceof Error ? error.message : 'Installing ipykernel failed.'
        }
      } satisfies ApiErrorResponse)
    }
  })

  // Fire-and-forget signal from nbcli that an agent is executing a notebook;
  // fans out to every session on that workspace so their panels focus it.
  server.post('/api/jupyter/workspace/activity', async (request, reply) => {
    const body = request.body as { cwd?: string; notebook?: string } | null
    const cwd = resolveKnownWorkspaceCwd(body?.cwd)
    if (cwd === null) {
      return sendWorkspaceNotFound(reply)
    }
    if (typeof cwd !== 'string') {
      return reply.code(cwd.code === 'bad_request' ? 400 : 404).send({ error: cwd } satisfies ApiErrorResponse)
    }
    const notebook = validateWorkspaceNotebookPath(body?.notebook)
    if (typeof notebook !== 'string') {
      return reply.code(400).send({ error: notebook } satisfies ApiErrorResponse)
    }

    const createdAt = new Date().toISOString()
    for (const session of agentSessionService.listVisibleSessions()) {
      try {
        if (fs.realpathSync(session.cwd) !== cwd) {
          continue
        }
      } catch {
        continue
      }
      sessionEventBus.publish({
        id: `nb_activity_${session.id}_${Date.now()}`,
        type: 'notebook.activity',
        sessionId: session.id,
        createdAt,
        path: notebook
      })
    }

    return reply.code(204).send()
  })

  server.post('/api/jupyter/workspace/execution', { bodyLimit: 8 * 1024 * 1024 }, async (request, reply) => {
    const body = request.body as Record<string, unknown> | null
    const cwd = resolveKnownWorkspaceCwd(body?.cwd)
    if (cwd === null) {
      return sendWorkspaceNotFound(reply)
    }
    if (typeof cwd !== 'string') {
      return reply.code(cwd.code === 'bad_request' ? 400 : 404).send({ error: cwd } satisfies ApiErrorResponse)
    }

    const notebook = validateWorkspaceNotebookPath(body?.notebook)
    if (typeof notebook !== 'string') {
      return reply.code(400).send({ error: notebook } satisfies ApiErrorResponse)
    }

    if (!body) {
      return sendBadRequest(reply, 'request body is required.')
    }

    const detail = validateNotebookExecutionDetail(body, notebook)
    if ('code' in detail) {
      return reply.code(400).send({ error: detail } satisfies ApiErrorResponse)
    }

    for (const session of agentSessionService.listVisibleSessions()) {
      try {
        if (fs.realpathSync(session.cwd) !== cwd) {
          continue
        }
      } catch {
        continue
      }

      const sessionDetail = agentSessionService.getSessionDetail(session.id)
      const runningTurn = sessionDetail?.turns.find((turn) => turn.status === 'running') ?? null
      agentSessionService.recordNotebookExecution({
        sessionId: session.id,
        turnId: runningTurn?.id ?? null,
        provider: session.provider,
        eventType: 'notebook.execution',
        streamKind: 'notebook',
        title: 'Notebook execution',
        summary: `${detail.notebook} · ${detail.cellId ?? 'exec-code'} · ${detail.status}`,
        status: detail.status,
        canonicalJson: detail
      })
    }

    return reply.code(204).send()
  })
}
