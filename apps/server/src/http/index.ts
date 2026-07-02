import fastify from 'fastify'

import { config } from '../config/env'
import { registerServerPlugins } from './plugins/placeholder'
import { healthRoute } from './routes/health'
import { mcpRoute } from './routes/mcp'
import { sessionsRoute } from './routes/sessions'

export function createServer() {
  const server = fastify({
    logger: {
      level: config.logLevel
    }
  })

  return server
    .register(healthRoute)
    .register(mcpRoute)
    .register(sessionsRoute)
    .after(async () => {
      await registerServerPlugins(server)
    })
}
