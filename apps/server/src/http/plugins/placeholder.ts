import { type FastifyInstance } from 'fastify'

export async function registerServerPlugins(server: FastifyInstance): Promise<void> {
  // Reserved plugin boundary for future middleware, observability, and request tracing.
  return
}
