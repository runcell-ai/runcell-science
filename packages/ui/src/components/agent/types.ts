import type {
  AgentTurnDiff,
  AgentEvent,
  AgentMessage,
  AgentPendingRequest,
  AgentProvider
} from '@open-science/contracts'

export type AgentProviderOption = {
  value: AgentProvider
  label: string
}

export type AgentConnectionStatus = 'idle' | 'connecting' | 'live' | 'error'

export type AgentRequestDecision = 'allow' | 'deny'

export type AgentTimelineItem = {
  id: string
  createdAt: string
} & (
  | {
      type: 'message'
      message: AgentMessage
    }
  | {
      type: 'activity'
      event: AgentEvent
    }
  | {
      type: 'diff'
      diff: AgentTurnDiff
    }
  | {
      type: 'request'
      request: AgentPendingRequest
    }
)
