const cwdStorageKey = 'open-science.cwd'
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
