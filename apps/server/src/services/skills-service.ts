import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type {
  AgentProvider,
  ImportSkillResponse,
  ListSkillsResponse,
  SkillView
} from '@runcell-science/contracts'

import { config } from '../config/env'
import { getDb } from '../db/connection'
import type { SkillsListResponse } from '../runtime/providers/codex/generated/v2/SkillsListResponse'
import { McpManagementError, mcpManagementService } from './mcp-management-service'

const SKILL_NAME_PATTERN = /^[A-Za-z0-9_-]+$/
const SKILLS_LIST_TIMEOUT_MS = 30_000

function assertValidSkillName(name: string): void {
  if (!SKILL_NAME_PATTERN.test(name)) {
    throw new McpManagementError(
      'invalid_skill_name',
      'Skill name may only contain letters, digits, hyphens, and underscores.',
      400
    )
  }
}

/**
 * Skills stay owned by the agent runtimes: this service only projects their
 * metadata (codex skills/list RPC; claude session init slash commands) and
 * copies SKILL.md folders into the native directories on import. It never
 * parses or executes skill bodies.
 */
export class SkillsService {
  async listSkills(input: {
    provider: AgentProvider
    cwd?: string
    sessionId?: string
    refresh?: boolean
  }): Promise<ListSkillsResponse> {
    if (input.provider === 'codex') {
      return this.listCodexSkills(input.cwd, input.refresh === true)
    }
    return this.listClaudeSkills(input.sessionId)
  }

  private async listCodexSkills(cwd: string | undefined, forceReload: boolean): Promise<ListSkillsResponse> {
    const warnings: string[] = []
    const skills: SkillView[] = []
    try {
      const response = await mcpManagementService.codexRequest<SkillsListResponse>(
        'skills/list',
        { cwds: cwd ? [cwd] : [], forceReload },
        SKILLS_LIST_TIMEOUT_MS
      )
      const seen = new Set<string>()
      for (const entry of response.data) {
        for (const skill of entry.skills) {
          if (seen.has(skill.path)) {
            continue
          }
          seen.add(skill.path)
          skills.push({
            provider: 'codex',
            name: skill.name,
            description: skill.shortDescription ?? skill.description ?? null,
            path: skill.path,
            scope: skill.scope,
            enabled: skill.enabled
          })
        }
        for (const error of entry.errors) {
          const detail = (error as { message?: string }).message ?? JSON.stringify(error)
          warnings.push(`skill load error: ${detail}`)
        }
      }
    } catch (error) {
      warnings.push(`Codex skills unavailable: ${error instanceof Error ? error.message : String(error)}`)
    }
    return { skills, warnings }
  }

  private listClaudeSkills(sessionId: string | undefined): ListSkillsResponse {
    if (!sessionId) {
      return {
        skills: [],
        warnings: ['Claude skills are read from a running session. Start a session to see its commands.']
      }
    }

    const row = getDb()
      .prepare(
        `SELECT raw_json FROM agent_events
         WHERE session_id = ? AND event_type = 'claude.system.init'
         ORDER BY rowid DESC LIMIT 1`
      )
      .get(sessionId) as { raw_json?: string } | undefined

    if (!row?.raw_json) {
      return { skills: [], warnings: ['No Claude session init data found yet.'] }
    }

    try {
      const init = JSON.parse(row.raw_json) as { slash_commands?: unknown }
      const names = Array.isArray(init.slash_commands)
        ? init.slash_commands.filter((n): n is string => typeof n === 'string')
        : []
      return {
        skills: names.map((name) => ({
          provider: 'claude' as const,
          name,
          description: null,
          path: null,
          scope: 'builtin' as const,
          enabled: true
        })),
        warnings: []
      }
    } catch {
      return { skills: [], warnings: ['Failed to parse Claude session init data.'] }
    }
  }

  async setCodexSkillEnabled(input: { name?: string; path?: string; enabled: boolean }): Promise<void> {
    if (!input.name && !input.path) {
      throw new McpManagementError('bad_request', 'Provide a skill name or path.', 400)
    }
    await mcpManagementService.codexRequest(
      'skills/config/write',
      {
        ...(input.path ? { path: input.path } : { name: input.name }),
        enabled: input.enabled
      },
      SKILLS_LIST_TIMEOUT_MS
    )
  }

  importSkill(input: { name: string; content: string; providers: AgentProvider[] }): ImportSkillResponse {
    assertValidSkillName(input.name)
    if (input.content.trim().length === 0) {
      throw new McpManagementError('invalid_skill_content', 'SKILL.md content is empty.', 400)
    }
    if (input.providers.length === 0) {
      throw new McpManagementError('no_target_providers', 'Pick at least one provider to import into.', 400)
    }

    const result: ImportSkillResponse = { written: [], skipped: [] }
    for (const provider of input.providers) {
      const root =
        provider === 'claude'
          ? config.claudeConfigDir
            ? path.join(config.claudeConfigDir, 'skills')
            : path.join(os.homedir(), '.claude', 'skills')
          : path.join(os.homedir(), '.agents', 'skills')

      const skillDir = path.join(root, input.name)
      const skillFile = path.join(skillDir, 'SKILL.md')
      if (fs.existsSync(skillFile)) {
        result.skipped.push(`${provider}:${input.name}`)
        continue
      }
      fs.mkdirSync(skillDir, { recursive: true })
      fs.writeFileSync(skillFile, input.content, 'utf8')
      result.written.push(`${provider}:${skillFile}`)
    }
    return result
  }
}

export const skillsService = new SkillsService()
