import type { FastifyPluginAsync } from 'fastify'

import type { ListMcpServersResponse } from '@open-science/contracts'

import { mcpManagementService } from '../../services/mcp-management-service'

export const mcpRoute: FastifyPluginAsync = async (server) => {
  server.get('/api/mcp/servers', async (request, reply) => {
    const query = request.query as { cwd?: string; refresh?: string }
    const response = await mcpManagementService.listServers({
      cwd: typeof query.cwd === 'string' && query.cwd.length > 0 ? query.cwd : undefined,
      refresh: query.refresh === 'true'
    })
    reply.send(response satisfies ListMcpServersResponse)
  })
}
