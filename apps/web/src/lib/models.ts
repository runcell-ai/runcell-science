import type { AgentModelOption } from '@runcell-science/ui'

/**
 * Fallback choices used while /api/models is loading or unavailable. The real
 * catalogs come from the server: Codex via the app-server `model/list` RPC and
 * Claude via the agent SDK's `supportedModels()`. We only seed the always-valid
 * "Default" (null) row per provider here — concrete models arrive dynamically,
 * so hardcoding aliases would risk duplicate/stale rows once the list loads.
 */
export const fallbackModelOptions: AgentModelOption[] = [
  { provider: 'codex', model: null, label: 'Default', hint: 'Configured default' },
  { provider: 'claude', model: null, label: 'Default', hint: 'Configured default' }
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
