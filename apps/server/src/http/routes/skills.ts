import type { FastifyPluginAsync, FastifyReply } from 'fastify'

import type {
  ApiErrorResponse,
  ImportSkillRequest,
  ImportSkillResponse,
  ListSkillsResponse,
  MutateMcpServerResponse,
  SetSkillEnabledRequest
} from '@runcell-science/contracts'

import { McpManagementError } from '../../services/mcp-management-service'
import { skillsService } from '../../services/skills-service'

function sendSkillsError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof McpManagementError) {
    return reply.code(error.statusCode).send({
      error: { code: error.code, message: error.message }
    } satisfies ApiErrorResponse)
  }
  return reply.code(502).send({
    error: {
      code: 'skills_operation_failed',
      message: error instanceof Error ? error.message : String(error)
    }
  } satisfies ApiErrorResponse)
}

export const skillsRoute: FastifyPluginAsync = async (server) => {
  server.get('/api/skills', async (request, reply) => {
    const query = request.query as { provider?: string; cwd?: string; sessionId?: string; refresh?: string }
    if (query.provider === 'grok') {
      // Grok exposes slash commands over ACP (available_commands_update) but
      // the skills catalog is not wired for it yet; an empty list keeps the
      // composer quiet instead of erroring on every grok session.
      return reply.send({ skills: [], warnings: [] } satisfies ListSkillsResponse)
    }
    if (query.provider !== 'codex' && query.provider !== 'claude') {
      return reply.code(400).send({
        error: { code: 'bad_request', message: 'provider must be codex or claude.' }
      } satisfies ApiErrorResponse)
    }

    try {
      const response = await skillsService.listSkills({
        provider: query.provider,
        cwd: typeof query.cwd === 'string' && query.cwd.length > 0 ? query.cwd : undefined,
        sessionId: typeof query.sessionId === 'string' && query.sessionId.length > 0 ? query.sessionId : undefined,
        refresh: query.refresh === 'true'
      })
      reply.send(response satisfies ListSkillsResponse)
    } catch (error) {
      sendSkillsError(reply, error)
    }
  })

  server.post('/api/skills/import', async (request, reply) => {
    const body = request.body as Partial<ImportSkillRequest> | undefined
    const providers = Array.isArray(body?.providers)
      ? body.providers.filter((p): p is 'codex' | 'claude' => p === 'codex' || p === 'claude')
      : []
    if (!body || typeof body.name !== 'string' || typeof body.content !== 'string') {
      return reply.code(400).send({
        error: { code: 'bad_request', message: 'name, content, and providers are required.' }
      } satisfies ApiErrorResponse)
    }

    try {
      const response = skillsService.importSkill({ name: body.name, content: body.content, providers })
      reply.send(response satisfies ImportSkillResponse)
    } catch (error) {
      sendSkillsError(reply, error)
    }
  })

  server.patch('/api/skills/codex/enabled', async (request, reply) => {
    const body = request.body as Partial<SetSkillEnabledRequest> | undefined
    if (!body || typeof body.enabled !== 'boolean') {
      return reply.code(400).send({
        error: { code: 'bad_request', message: 'enabled boolean is required.' }
      } satisfies ApiErrorResponse)
    }

    try {
      await skillsService.setCodexSkillEnabled({
        name: typeof body.name === 'string' ? body.name : undefined,
        path: typeof body.path === 'string' ? body.path : undefined,
        enabled: body.enabled
      })
      reply.send({ ok: true } satisfies MutateMcpServerResponse)
    } catch (error) {
      sendSkillsError(reply, error)
    }
  })
}
