import type { AgentModelOption } from '@open-science/ui'

/**
 * Fallback choices used while /api/models is loading or unavailable. Codex
 * models normally come from the local Codex app-server model/list RPC.
 */
export const fallbackModelOptions: AgentModelOption[] = [
  { provider: 'codex', model: null, label: 'Default', hint: 'Configured default' },
  { provider: 'claude', model: null, label: 'Default', hint: 'Configured default' },
  { provider: 'claude', model: 'opus', label: 'Opus' },
  { provider: 'claude', model: 'sonnet', label: 'Sonnet' },
  { provider: 'claude', model: 'haiku', label: 'Haiku' }
]

export function mergeModelOptions(primary: AgentModelOption[], fallback: AgentModelOption[]): AgentModelOption[] {
  const seen = new Set<string>()
  const result: AgentModelOption[] = []
  for (const option of [...primary, ...fallback]) {
    const key = `${option.provider}:${option.model ?? 'default'}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(option)
  }
  return result
}
