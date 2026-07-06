import type { FastifyPluginAsync } from 'fastify'

import type { ListAgentModelsResponse } from '@runcell-science/contracts'

import { agentModelService } from '../../services/agent-model-service'

export const modelsRoute: FastifyPluginAsync = async (server) => {
  server.get('/api/models', async (_request, reply) => {
    const response = await agentModelService.listModelOptions()
    reply.send(response satisfies ListAgentModelsResponse)
  })
}
