import type { AgentModelOption, ListAgentModelsResponse } from '@runcell-science/contracts'

import { fetchClaudeSupportedModels } from '../runtime/providers/claude/claude-models'
import type { ModelListResponse } from '../runtime/providers/codex/generated/v2/ModelListResponse'
import { fetchGrokModelCatalog } from '../runtime/providers/grok/grok-models'
import { mcpManagementService } from './mcp-management-service'

const codexDefaultOption: AgentModelOption = {
  provider: 'codex',
  model: null,
  label: 'Default',
  hint: 'Configured default'
}

const claudeDefaultOption: AgentModelOption = {
  provider: 'claude',
  model: null,
  label: 'Default',
  hint: 'Configured default'
}

const grokDefaultOption: AgentModelOption = {
  provider: 'grok',
  model: null,
  label: 'Default',
  hint: 'Configured default'
}

const MODEL_LIST_TIMEOUT_MS = 15_000

function cleanHint(value: string | null | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized && normalized.length > 0 ? normalized : undefined
}

function extractCurrentDefaultModel(description: string | null | undefined): string | null {
  const normalized = description?.trim()
  if (!normalized) {
    return null
  }

  const match = normalized.match(/\bcurrently\s+(.+?)\)\s*(?:\u00b7|$)/i)
  return match?.[1]?.trim() || null
}

function defaultLabel(providerDefault: string | null | undefined): string {
  return providerDefault ? `Default (${providerDefault})` : 'Default'
}

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
    const [codexModels, claudeModels, grokModels] = await Promise.all([
      this.listCodexModels(warnings),
      this.listClaudeModels(warnings),
      this.listGrokModels(warnings)
    ])

    return { models: dedupeOptions([...codexModels, ...claudeModels, ...grokModels]), warnings }
  }

  private async listCodexModels(warnings: string[]): Promise<AgentModelOption[]> {
    const options: AgentModelOption[] = [{ ...codexDefaultOption }]

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
          const label = model.displayName || modelId
          if (model.isDefault) {
            options[0] = {
              ...options[0],
              label: defaultLabel(label),
              hint: cleanHint(model.description) ?? 'Codex default'
            }
          }
          options.push({
            provider: 'codex',
            model: modelId,
            label,
            ...(cleanHint(model.description) || model.isDefault
              ? { hint: cleanHint(model.description) ?? 'Codex default' }
              : {})
          })
        }
        cursor = page.nextCursor
      } while (cursor)
    } catch (error) {
      warnings.push(`Codex model list unavailable: ${errorMessage(error)}`)
    }

    return options
  }

  private async listClaudeModels(warnings: string[]): Promise<AgentModelOption[]> {
    const options: AgentModelOption[] = [{ ...claudeDefaultOption }]

    try {
      const models = await fetchClaudeSupportedModels(MODEL_LIST_TIMEOUT_MS)
      for (const model of models) {
        // The SDK's synthetic "default" row is already covered by our null
        // Default option, and its value ("default") is not a concrete model id.
        if (model.value === 'default') {
          const currentDefault = extractCurrentDefaultModel(model.description)
          options[0] = {
            ...options[0],
            label: defaultLabel(currentDefault),
            hint: cleanHint(model.description) ?? model.displayName
          }
          continue
        }
        options.push({
          provider: 'claude',
          model: model.value,
          label: model.displayName || model.value,
          ...(cleanHint(model.description) ? { hint: cleanHint(model.description) } : {})
        })
      }
    } catch (error) {
      warnings.push(`Claude model list unavailable: ${errorMessage(error)}`)
    }

    return options
  }

  private async listGrokModels(warnings: string[]): Promise<AgentModelOption[]> {
    const options: AgentModelOption[] = [{ ...grokDefaultOption }]

    try {
      const catalog = await fetchGrokModelCatalog(MODEL_LIST_TIMEOUT_MS)
      for (const model of catalog.models) {
        const label = model.name || model.modelId
        if (model.modelId === catalog.currentModelId) {
          options[0] = {
            ...options[0],
            label: defaultLabel(label),
            hint: cleanHint(model.description) ?? 'Grok default'
          }
        }
        options.push({
          provider: 'grok',
          model: model.modelId,
          label,
          ...(cleanHint(model.description) ? { hint: cleanHint(model.description) } : {})
        })
      }
    } catch (error) {
      warnings.push(`Grok model list unavailable: ${errorMessage(error)}`)
    }

    return options
  }
}

export const agentModelService = new AgentModelService()
