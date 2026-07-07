import fs from 'node:fs'
import path from 'node:path'

import { type FastifyPluginAsync } from 'fastify'

import { config } from '../../config/env'

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2'
}

function safeResolve(root: string, pathname: string): string | null {
  let decoded = '/'
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }

  const relativePath = decoded.replace(/^\/+/, '')
  const resolved = path.resolve(root, relativePath)
  return resolved === root || resolved.startsWith(`${root}${path.sep}`) ? resolved : null
}

export const staticWebRoute: FastifyPluginAsync = async (server) => {
  if (!config.staticWebDir) {
    return
  }

  const root = path.resolve(config.staticWebDir)
  const indexPath = path.join(root, 'index.html')

  server.route({
    method: ['GET', 'HEAD'],
    url: '/*',
    handler: async (request, reply) => {
      const url = new URL(request.url, 'http://127.0.0.1')

      if (url.pathname === '/healthz' || url.pathname.startsWith('/api/')) {
        reply.callNotFound()
        return
      }

      const requestedPath = safeResolve(root, url.pathname)
      if (!requestedPath) {
        reply.code(400).send({ error: { message: 'Invalid static asset path.' } })
        return
      }

      const candidatePath =
        fs.existsSync(requestedPath) && fs.statSync(requestedPath).isFile() ? requestedPath : indexPath

      if (!fs.existsSync(candidatePath)) {
        reply.callNotFound()
        return
      }

      const extension = path.extname(candidatePath).toLowerCase()
      const body = fs.readFileSync(candidatePath)
      reply.type(contentTypes[extension] ?? 'application/octet-stream')
      reply.header('content-length', body.byteLength)
      reply.send(request.method === 'HEAD' ? undefined : body)
    }
  })
}
