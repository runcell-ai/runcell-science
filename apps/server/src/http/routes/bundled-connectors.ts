import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import type {
  ApiErrorResponse,
  ListBundledScienceConnectorsResponse,
  MutateMcpServerResponse,
  SetBundledScienceConnectorEnabledRequest
} from '@runcell-science/contracts'

import {
  bundledScienceConnectorsService
} from '../../services/bundled-science-connectors-service'
import { McpManagementError } from '../../services/mcp-management-service'

function sendError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof McpManagementError) {
    return reply.code(error.statusCode).send({
      error: { code: error.code, message: error.message }
    } satisfies ApiErrorResponse)
  }
  return reply.code(500).send({
    error: {
      code: 'bundled_connector_operation_failed',
      message: error instanceof Error ? error.message : String(error)
    }
  } satisfies ApiErrorResponse)
}

export const bundledConnectorsRoute: FastifyPluginAsync = async (server) => {
  server.get('/api/bundled-connectors', async (request, reply) => {
    const query = request.query as { cwd?: string }
    if (typeof query.cwd !== 'string' || query.cwd.length === 0) {
      return reply.code(400).send({
        error: { code: 'bad_request', message: 'cwd query parameter is required.' }
      } satisfies ApiErrorResponse)
    }

    try {
      const response = bundledScienceConnectorsService.listConnectors(query.cwd)
      reply.send(response satisfies ListBundledScienceConnectorsResponse)
    } catch (error) {
      sendError(reply, error)
    }
  })

  server.patch('/api/bundled-connectors/:name/enabled', async (request, reply) => {
    const params = request.params as { name?: string }
    const body = request.body as Partial<SetBundledScienceConnectorEnabledRequest> | undefined
    if (typeof params.name !== 'string' || typeof body?.cwd !== 'string' || typeof body.enabled !== 'boolean') {
      return reply.code(400).send({
        error: { code: 'bad_request', message: 'connector name, cwd, and enabled are required.' }
      } satisfies ApiErrorResponse)
    }

    try {
      bundledScienceConnectorsService.setEnabled({
        name: params.name,
        cwd: body.cwd,
        enabled: body.enabled
      })
      reply.send({ ok: true } satisfies MutateMcpServerResponse)
    } catch (error) {
      sendError(reply, error)
    }
  })
}
