import fastify from 'fastify'

import { config } from '../config/env'
import { registerServerPlugins } from './plugins/placeholder'
import { healthRoute } from './routes/health'
import { jupyterRoute } from './routes/jupyter'
import { mcpRoute } from './routes/mcp'
import { sessionsRoute } from './routes/sessions'
import { skillsRoute } from './routes/skills'

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
    .register(jupyterRoute)
    .register(skillsRoute)
    .after(async () => {
      await registerServerPlugins(server)
    })
}
