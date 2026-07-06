import type { AgentProvider } from '@runcell-science/contracts'
import type { AgentModelChoice } from '@runcell-science/ui'

const cwdStorageKey = 'open-science.cwd'
const modelChoiceStorageKey = 'open-science.model-choice'
const envDefaultCwd = (import.meta.env.VITE_AGENT_DEFAULT_CWD as string | undefined) ?? ''

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

export function readStoredModelChoice(): AgentModelChoice | null {
  try {
    const raw = window.localStorage.getItem(modelChoiceStorageKey)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as Partial<AgentModelChoice>
    if (parsed.provider !== 'codex' && parsed.provider !== 'claude') {
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
