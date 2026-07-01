import { type FastifyPluginAsync } from 'fastify'
import { type HealthCheckResponse } from '@open-science/contracts'

import { config } from '../../config/env'

export const healthRoute: FastifyPluginAsync = async (server) => {
  server.get(
    '/healthz',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['ok', 'degraded'] },
              service: { type: 'string' },
              version: { type: 'string' },
              checkedAt: { type: 'string' },
              environment: { type: 'string' }
            },
            required: ['status', 'service', 'version', 'checkedAt', 'environment']
          }
        }
      }
    },
    async (_request, reply) => {
      reply.send({
        status: 'ok',
        service: 'open-science-server',
        version: process.env.npm_package_version ?? '0.1.0',
        checkedAt: new Date().toISOString(),
        environment: config.nodeEnv
      } satisfies HealthCheckResponse)
    }
  )
}
