import type {
  AgentProviderLoginAttempt,
  AgentProviderSnapshot
} from '@runcell-science/contracts'

export function setupTestOutcome(snapshot: AgentProviderSnapshot): {
  kind: 'success' | 'error'
  message: string
} {
  if (snapshot.availability === 'ready' || snapshot.availability === 'needs_auth') {
    return {
      kind: 'success',
      message: `Test passed${snapshot.version ? ` (${snapshot.version})` : ''}.`
    }
  }
  return {
    kind: 'error',
    message:
      snapshot.message ??
      (snapshot.installed
        ? 'The Provider could not be verified with these settings.'
        : 'The Provider was not found with these settings.')
  }
}

export function isLoginAttemptExpired(
  attempt: Pick<AgentProviderLoginAttempt, 'expiresAt'>,
  now = Date.now()
): boolean {
  return Date.parse(attempt.expiresAt) <= now
}
