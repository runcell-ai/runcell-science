import fastify from 'fastify'

import { config } from '../config/env'
import { registerServerPlugins } from './plugins/placeholder'
import { bundledConnectorsRoute } from './routes/bundled-connectors'
import { healthRoute } from './routes/health'
import { jupyterRoute } from './routes/jupyter'
import { mcpRoute } from './routes/mcp'
import { modelsRoute } from './routes/models'
import { sessionsRoute } from './routes/sessions'
import { skillsRoute } from './routes/skills'
import { staticWebRoute } from './routes/static-web'

export function createServer() {
  const server = fastify({
    logger: {
      level: config.logLevel
    }
  })

  return server
    .register(healthRoute)
    .register(bundledConnectorsRoute)
    .register(mcpRoute)
    .register(modelsRoute)
    .register(sessionsRoute)
    .register(jupyterRoute)
    .register(skillsRoute)
    .register(staticWebRoute)
    .after(async () => {
      await registerServerPlugins(server)
    })
}
