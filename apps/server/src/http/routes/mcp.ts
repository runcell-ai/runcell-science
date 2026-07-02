import type { FastifyPluginAsync, FastifyReply } from 'fastify'

import type {
  AddMcpServerRequest,
  ApiErrorResponse,
  ImportMcpServersRequest,
  ImportMcpServersResponse,
  ListMcpServersResponse,
  McpOauthLoginResponse,
  MutateMcpServerResponse,
  RemoveMcpServerRequest,
  SetMcpServerEnabledRequest
} from '@open-science/contracts'

import { McpManagementError, mcpManagementService } from '../../services/mcp-management-service'

function sendMcpError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof McpManagementError) {
    return reply.code(error.statusCode).send({
      error: { code: error.code, message: error.message }
    } satisfies ApiErrorResponse)
  }
  return reply.code(502).send({
    error: {
      code: 'mcp_operation_failed',
      message: error instanceof Error ? error.message : String(error)
    }
  } satisfies ApiErrorResponse)
}

export const mcpRoute: FastifyPluginAsync = async (server) => {
  server.get('/api/mcp/servers', async (request, reply) => {
    const query = request.query as { cwd?: string; refresh?: string }
    try {
      const response = await mcpManagementService.listServers({
        cwd: typeof query.cwd === 'string' && query.cwd.length > 0 ? query.cwd : undefined,
        refresh: query.refresh === 'true'
      })
      reply.send(response satisfies ListMcpServersResponse)
    } catch (error) {
      sendMcpError(reply, error)
    }
  })

  server.post('/api/mcp/servers', async (request, reply) => {
    const body = request.body as Partial<AddMcpServerRequest> | undefined
    if (!body || (body.provider !== 'codex' && body.provider !== 'claude') || typeof body.name !== 'string' || !body.config) {
      return reply.code(400).send({
        error: { code: 'bad_request', message: 'provider, name, and config are required.' }
      } satisfies ApiErrorResponse)
    }

    try {
      await mcpManagementService.addServer({ provider: body.provider, name: body.name, config: body.config })
      reply.send({ ok: true } satisfies MutateMcpServerResponse)
    } catch (error) {
      sendMcpError(reply, error)
    }
  })

  server.post('/api/mcp/servers/remove', async (request, reply) => {
    const body = request.body as Partial<RemoveMcpServerRequest> | undefined
    if (
      !body ||
      (body.provider !== 'codex' && body.provider !== 'claude') ||
      typeof body.name !== 'string' ||
      (body.scope !== 'user' && body.scope !== 'project' && body.scope !== 'local')
    ) {
      return reply.code(400).send({
        error: { code: 'bad_request', message: 'provider, scope, and name are required.' }
      } satisfies ApiErrorResponse)
    }

    try {
      await mcpManagementService.removeServer({
        provider: body.provider,
        scope: body.scope,
        name: body.name,
        cwd: typeof body.cwd === 'string' ? body.cwd : undefined
      })
      reply.send({ ok: true } satisfies MutateMcpServerResponse)
    } catch (error) {
      sendMcpError(reply, error)
    }
  })

  server.patch('/api/mcp/servers/:provider/:name/enabled', async (request, reply) => {
    const params = request.params as { provider?: string; name?: string }
    const body = request.body as Partial<SetMcpServerEnabledRequest> | undefined
    if (params.provider !== 'codex' || typeof params.name !== 'string' || typeof body?.enabled !== 'boolean') {
      return reply.code(400).send({
        error: {
          code: 'bad_request',
          message: 'Enable/disable is only supported for codex servers and requires an "enabled" boolean.'
        }
      } satisfies ApiErrorResponse)
    }

    try {
      await mcpManagementService.setCodexServerEnabled(params.name, body.enabled)
      reply.send({ ok: true } satisfies MutateMcpServerResponse)
    } catch (error) {
      sendMcpError(reply, error)
    }
  })

  server.post('/api/mcp/servers/:provider/:name/login', async (request, reply) => {
    const params = request.params as { provider?: string; name?: string }
    if (params.provider !== 'codex' || typeof params.name !== 'string') {
      return reply.code(400).send({
        error: {
          code: 'bad_request',
          message: 'OAuth login is currently only supported for codex servers. For Claude Code, run `claude` in a terminal and use /mcp to authenticate.'
        }
      } satisfies ApiErrorResponse)
    }

    try {
      const response = await mcpManagementService.codexOauthLogin(params.name)
      reply.send(response satisfies McpOauthLoginResponse)
    } catch (error) {
      sendMcpError(reply, error)
    }
  })

  server.post('/api/mcp/import', async (request, reply) => {
    const body = request.body as Partial<ImportMcpServersRequest> | undefined
    const providers = Array.isArray(body?.providers)
      ? body.providers.filter((p): p is 'codex' | 'claude' => p === 'codex' || p === 'claude')
      : []
    if (!body || typeof body.json !== 'string') {
      return reply.code(400).send({
        error: { code: 'bad_request', message: 'json and providers are required.' }
      } satisfies ApiErrorResponse)
    }

    try {
      const response = await mcpManagementService.importServers({ json: body.json, providers })
      reply.send(response satisfies ImportMcpServersResponse)
    } catch (error) {
      sendMcpError(reply, error)
    }
  })
}
