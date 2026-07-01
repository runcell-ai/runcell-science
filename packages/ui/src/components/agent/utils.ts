import type {
  AgentEvent,
  AgentProvider,
  AgentSession,
  AgentSessionStatus,
  AgentSessionSummary,
  AgentTurn
} from '@open-science/contracts'

export function providerLabel(provider: AgentProvider): string {
  switch (provider) {
    case 'codex':
      return 'Codex'
    case 'claude':
      return 'Claude Code'
    default:
      return provider
  }
}

export function statusLabel(
  status: AgentSessionStatus | AgentTurn['status'] | string
): string {
  switch (status) {
    case 'pending_activation':
      return 'Pending'
    case 'ready':
      return 'Ready'
    case 'running':
      return 'Running'
    case 'waiting':
      return 'Waiting'
    case 'stopped':
      return 'Stopped'
    case 'error':
      return 'Error'
    case 'completed':
      return 'Completed'
    case 'failed':
      return 'Failed'
    case 'interrupted':
      return 'Interrupted'
    case 'open':
      return 'Open'
    case 'resolved':
      return 'Resolved'
    case 'started':
      return 'Started'
    case 'draft':
      return 'Draft'
    case 'connecting':
      return 'Connecting'
    case 'live':
      return 'Live'
    default:
      return status
  }
}

export function displaySessionTitle(
  session: AgentSessionSummary | AgentSession
): string {
  return session.title?.trim() || `${providerLabel(session.provider)} session`
}

export function compactText(value: string, maxLength = 88): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength - 1)}...`
}

export function visibleActivitySummary(
  summary: string | undefined
): string | undefined {
  const trimmed = summary?.trim()
  if (!trimmed || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return undefined
  }
  return summary
}

export function eventTitle(event: AgentEvent): string {
  const title = event.title?.trim()
  if (title) {
    return title
  }

  return event.eventType
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[./_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function eventSummary(event: AgentEvent): string | undefined {
  return visibleActivitySummary(event.summary ?? undefined)
}
