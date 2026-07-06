import type {
  AgentArtifact,
  AgentTurnDiff,
  AgentEvent,
  AgentMessage,
  NotebookExecutionDetail,
  AgentPendingRequest,
  AgentProvider,
  AgentModelOption as ContractAgentModelOption
} from '@runcell-science/contracts'

export type AgentProviderOption = {
  value: AgentProvider
  label: string
}

/** A selectable agent+model pair for the composer model picker. */
export type AgentModelOption = ContractAgentModelOption

/** The agent+model chosen from the model picker. */
export type AgentModelChoice = {
  provider: AgentProvider
  model: string | null
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
      type: 'notebook-execution'
      event: AgentEvent
      detail: NotebookExecutionDetail
    }
  | {
      type: 'diff'
      diff: AgentTurnDiff
    }
  | {
      type: 'artifact'
      artifact: AgentArtifact
      active: boolean
    }
  | {
      type: 'request'
      request: AgentPendingRequest
    }
)
