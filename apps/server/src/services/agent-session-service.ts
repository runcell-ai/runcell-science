import type {
  AgentProvider,
  AgentRuntimeMode,
  AgentSessionDetail,
  AgentSessionSummary,
  CreateAgentSessionResponse
} from '@open-science/contracts'

import {
  AgentSessionRepository,
  type CreatePendingAgentSessionInput
} from './agent-session-repository'

export interface CreateAgentSessionDraftInput {
  provider: AgentProvider
  cwd: string
  initialMessage: string
  model?: string | null
  runtimeMode?: AgentRuntimeMode
}

export interface CleanupStalePendingActivationInput {
  olderThanMs?: number
}

const defaultPendingActivationTtlMs = 24 * 60 * 60 * 1000

export class AgentSessionService {
  constructor(private readonly repository = new AgentSessionRepository()) {}

  listVisibleSessions(): AgentSessionSummary[] {
    return this.repository.listActivatedSessions()
  }

  getSessionDetail(sessionId: string): AgentSessionDetail | null {
    return this.repository.findSessionDetail(sessionId)
  }

  createPendingSessionForInitialMessage(input: CreateAgentSessionDraftInput): CreateAgentSessionResponse {
    const pendingInput: CreatePendingAgentSessionInput = {
      provider: input.provider,
      cwd: input.cwd,
      initialMessage: input.initialMessage,
      model: input.model ?? null,
      runtimeMode: input.runtimeMode ?? 'full_access'
    }
    const detail = this.repository.createPendingSessionFromInitialMessage(pendingInput)

    return {
      sessionId: detail.session.id,
      detail
    }
  }

  cleanupStalePendingActivationSessions(input: CleanupStalePendingActivationInput = {}): number {
    const olderThanMs = input.olderThanMs ?? defaultPendingActivationTtlMs
    const cutoffIso = new Date(Date.now() - olderThanMs).toISOString()
    return this.repository.cleanupPendingActivationSessionsWithoutAssistantResponse({ cutoffIso })
  }
}

export const agentSessionService = new AgentSessionService()
