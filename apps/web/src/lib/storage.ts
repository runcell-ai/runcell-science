import type { AgentProvider } from '@runcell-science/contracts'
import type { AgentModelChoice } from '@runcell-science/ui'

const cwdStorageKey = 'open-science.cwd'
const recentCwdsStorageKey = 'open-science.recent-cwds'
const modelChoiceStorageKey = 'open-science.model-choice'
const envDefaultCwd = (import.meta.env.VITE_AGENT_DEFAULT_CWD as string | undefined) ?? ''
const maxRecentCwds = 8

export function readStoredCwd(): string {
  try {
    return window.localStorage.getItem(cwdStorageKey) ?? envDefaultCwd
  } catch {
    return envDefaultCwd
  }
}

export function persistCwd(value: string): void {
  try {
    window.localStorage.setItem(cwdStorageKey, value)
  } catch {
    return
  }
}

/** Recently used working directories, most recent first. */
export function readRecentCwds(): string[] {
  try {
    const raw = window.localStorage.getItem(recentCwdsStorageKey)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  } catch {
    return []
  }
}

/** Move `value` to the front of the recent list and return the updated list. */
export function pushRecentCwd(value: string): string[] {
  const trimmed = value.trim()
  if (!trimmed) {
    return readRecentCwds()
  }
  const next = [trimmed, ...readRecentCwds().filter((item) => item !== trimmed)].slice(0, maxRecentCwds)
  try {
    window.localStorage.setItem(recentCwdsStorageKey, JSON.stringify(next))
  } catch {
    return next
  }
  return next
}

export function readStoredModelChoice(): AgentModelChoice | null {
  try {
    const raw = window.localStorage.getItem(modelChoiceStorageKey)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as Partial<AgentModelChoice>
    if (parsed.provider !== 'codex' && parsed.provider !== 'claude' && parsed.provider !== 'grok') {
      return null
    }
    const model = typeof parsed.model === 'string' ? parsed.model : null
    return { provider: parsed.provider as AgentProvider, model }
  } catch {
    return null
  }
}

export function persistModelChoice(choice: AgentModelChoice): void {
  try {
    window.localStorage.setItem(modelChoiceStorageKey, JSON.stringify(choice))
  } catch {
    return
  }
}
