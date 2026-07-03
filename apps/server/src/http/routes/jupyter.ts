import { type FastifyPluginAsync, type FastifyReply } from 'fastify'
import type {
  ApiErrorResponse,
  JupyterPythonEnvStatus,
  JupyterServerConnectionResponse,
  JupyterServerStatusResponse
} from '@open-science/contracts'

import { agentSessionService, jupyterServerManager } from '../../services'
import { JupyterEnvMissingError } from '../../services/jupyter-server-manager'

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

function missingEnvMessage(status: JupyterPythonEnvStatus): string {
  if (!status.pythonPath) {
    return 'No Python interpreter was found for this session. Missing jupyter_server and ipykernel.'
  }

  const missing = [
    status.hasJupyterServer ? null : 'jupyter_server',
    status.hasIpykernel ? null : 'ipykernel'
  ].filter((value): value is string => Boolean(value))

  return `Python interpreter ${status.pythonPath} is missing ${missing.join(' and ')}.`
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
          message: 'Jupyter server failed to start for this session.'
        }
      } satisfies ApiErrorResponse)
    }
  })
}
