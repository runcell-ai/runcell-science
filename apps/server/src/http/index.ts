import fastify from 'fastify'

import { config } from '../config/env'
import { registerServerPlugins } from './plugins/placeholder'
import { healthRoute } from './routes/health'

export function createServer() {
  const server = fastify({
    logger: {
      level: config.logLevel
    }
  })

  return server
    .register(healthRoute)
    .after(async () => {
      await registerServerPlugins(server)
    })
}
