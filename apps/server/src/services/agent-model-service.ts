import type { AgentModelOption, ListAgentModelsResponse } from '@open-science/contracts'

import type { ModelListResponse } from '../runtime/providers/codex/generated/v2/ModelListResponse'
import { mcpManagementService } from './mcp-management-service'

const codexDefaultOption: AgentModelOption = {
  provider: 'codex',
  model: null,
  label: 'Default',
  hint: 'Configured default'
}

const claudeDefaultOptions: AgentModelOption[] = [
  { provider: 'claude', model: null, label: 'Default', hint: 'Configured default' },
  { provider: 'claude', model: 'opus', label: 'Opus' },
  { provider: 'claude', model: 'sonnet', label: 'Sonnet' },
  { provider: 'claude', model: 'haiku', label: 'Haiku' }
]

const MODEL_LIST_TIMEOUT_MS = 15_000

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function dedupeOptions(options: AgentModelOption[]): AgentModelOption[] {
  const seen = new Set<string>()
  const result: AgentModelOption[] = []
  for (const option of options) {
    const key = `${option.provider}:${option.model ?? 'default'}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(option)
  }
  return result
}

export class AgentModelService {
  async listModelOptions(): Promise<ListAgentModelsResponse> {
    const warnings: string[] = []
    const models = [
      ...(await this.listCodexModels(warnings)),
      ...claudeDefaultOptions
    ]

    return { models: dedupeOptions(models), warnings }
  }

  private async listCodexModels(warnings: string[]): Promise<AgentModelOption[]> {
    const options: AgentModelOption[] = [codexDefaultOption]

    try {
      let cursor: string | null = null
      do {
        const page: ModelListResponse = await mcpManagementService.codexRequest<ModelListResponse>(
          'model/list',
          { cursor, includeHidden: false, limit: 100 },
          MODEL_LIST_TIMEOUT_MS
        )
        for (const model of page.data) {
          if (model.hidden) {
            continue
          }
          const modelId = model.model || model.id
          options.push({
            provider: 'codex',
            model: modelId,
            label: model.displayName || modelId,
            ...(model.isDefault ? { hint: 'Codex default' } : {})
          })
        }
        cursor = page.nextCursor
      } while (cursor)
    } catch (error) {
      warnings.push(`Codex model list unavailable: ${errorMessage(error)}`)
    }

    return options
  }
}

export const agentModelService = new AgentModelService()
