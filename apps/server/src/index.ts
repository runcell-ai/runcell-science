import { config, ensureRuntimeDirs } from './config/env'
import { createServer } from './http'
import { closeDb } from './db/connection'
import { runMigrations } from './db/migrate'
import { runtimeRegistry } from './runtime'
import { jupyterServerManager } from './services'

async function bootstrap(): Promise<void> {
  ensureRuntimeDirs()

  await runMigrations()
  const server = createServer()

  const closeHooks = async () => {
    await jupyterServerManager.disposeAll()
    await runtimeRegistry.dispose()
    await server.close()
    closeDb()
  }

  process.on('SIGINT', async () => {
    await closeHooks()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    await closeHooks()
    process.exit(0)
  })

  await server.listen({
    port: config.port,
    host: config.host
  })

  console.log(`open-science server listening on http://${config.host}:${config.port}`)
}

bootstrap().catch((error) => {
  console.error('Failed to start server:', error)
  process.exit(1)
})
