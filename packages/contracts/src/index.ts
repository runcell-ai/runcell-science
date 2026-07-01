export type HealthStatus = 'ok' | 'degraded'

export interface HealthCheckResponse {
  status: HealthStatus
  service: string
  version: string
  checkedAt: string
  environment: string
}

export interface ApiInfo {
  service: 'web' | 'server'
  version: string
  environment: string
}

export type AgentProvider = 'codex' | 'claude'

export type AgentRuntimeMode = 'full_access' | 'default'

export type AgentSessionStatus =
  | 'pending_activation'
  | 'ready'
  | 'running'
  | 'waiting'
  | 'stopped'
  | 'error'

export type AgentTurnStatus = 'running' | 'completed' | 'failed' | 'interrupted'

export type AgentMessageRole = 'user' | 'assistant' | 'system'

export type AgentMessageStatus = 'pending' | 'streaming' | 'completed' | 'failed'

export type AgentPendingRequestStatus = 'open' | 'resolved'

export type AgentArtifactKind = 'image' | 'pdf' | 'markdown' | 'html' | 'url'

export type AgentArtifactSource = 'file' | 'url'

export type AgentDiffChangeKind = 'add' | 'delete' | 'update'
export type AgentDiffSource = 'provider' | 'checkpoint'

export interface AgentDiffFileChange {
  path: string
  previousPath: string | null
  kind: AgentDiffChangeKind
  diff: string
}

export interface AgentTurnDiff {
  id: string
  sessionId: string
  turnId: string
  provider: AgentProvider
  source: AgentDiffSource
  providerTurnId: string | null
  providerItemId: string | null
  files: AgentDiffFileChange[]
  unifiedDiff: string | null
  createdAt: string
  updatedAt: string
}

export interface AgentSession {
  id: string
  provider: AgentProvider
  title: string | null
  cwd: string
  model: string | null
  runtimeMode: AgentRuntimeMode
  permissionMode: string | null
  status: AgentSessionStatus
  activatedAt: string | null
  providerSessionId: string | null
  providerThreadId: string | null
  resumeCursorJson: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export interface AgentSessionSummary {
  id: string
  provider: AgentProvider
  title: string | null
  cwd: string
  model: string | null
  runtimeMode: AgentRuntimeMode
  status: Exclude<AgentSessionStatus, 'pending_activation'>
  activatedAt: string
  updatedAt: string
}

export interface AgentTurn {
  id: string
  sessionId: string
  providerTurnId: string | null
  status: AgentTurnStatus
  requestedAt: string
  completedAt: string | null
  error: string | null
}

export interface AgentMessage {
  id: string
  sessionId: string
  turnId: string | null
  role: AgentMessageRole
  text: string
  status: AgentMessageStatus
  providerItemId: string | null
  createdAt: string
  updatedAt: string
}

export interface AgentEvent {
  id: string
  sessionId: string
  turnId: string | null
  provider: AgentProvider
  eventType: string
  streamKind: string | null
  title: string | null
  summary: string | null
  status: string | null
  createdAt: string
}

export interface AgentPendingRequest {
  id: string
  sessionId: string
  turnId: string
  type: string
  status: AgentPendingRequestStatus
  title: string | null
  payloadJson: string
  responseJson: string | null
  createdAt: string
  resolvedAt: string | null
}

export type AgentArtifact =
  | {
      id: string
      sessionId: string
      turnId: string | null
      messageId: string | null
      kind: Exclude<AgentArtifactKind, 'url'>
      source: 'file'
      path: string
      url: null
      title: string | null
      createdAt: string
      updatedAt: string
    }
  | {
      id: string
      sessionId: string
      turnId: string | null
      messageId: string | null
      kind: 'url'
      source: 'url'
      path: null
      url: string
      title: string | null
      createdAt: string
      updatedAt: string
    }

export interface AgentSessionDetail {
  session: AgentSession
  turns: AgentTurn[]
  messages: AgentMessage[]
  events: AgentEvent[]
  diffs?: AgentTurnDiff[]
  artifacts: AgentArtifact[]
  pendingRequests: AgentPendingRequest[]
}

export interface AgentSessionWorktreeDiffStatusResponse {
  isGitRepository: boolean
}

export interface AgentSessionWorktreeDiffResponse {
  isGitRepository: boolean
  unifiedDiff: string | null
  generatedAt: string | null
}

export interface ListAgentSessionsResponse {
  sessions: AgentSessionSummary[]
}

export interface CreateAgentSessionRequest {
  provider: AgentProvider
  cwd: string
  initialMessage: string
  model?: string | null
  runtimeMode?: AgentRuntimeMode
}

export interface CreateAgentSessionResponse {
  sessionId: string
  detail: AgentSessionDetail
}

export interface CreateAgentTurnRequest {
  message: string
}

export interface CreateAgentTurnResponse {
  turn: AgentTurn
}

export type CreateAgentArtifactRequest =
  | {
      kind?: Exclude<AgentArtifactKind, 'url'>
      path: string
      title?: string | null
      turnId?: string | null
      messageId?: string | null
    }
  | {
      kind?: 'url'
      url: string
      title?: string | null
      turnId?: string | null
      messageId?: string | null
    }

export interface CreateAgentArtifactResponse {
  artifact: AgentArtifact
}

export interface AgentArtifactMarkdownContentResponse {
  artifact: AgentArtifact
  content: string
}

export interface ResolveAgentRequestRequest {
  decision: 'allow' | 'deny' | 'answer'
  answer?: string
}

export interface ResolveAgentRequestResponse {
  request: AgentPendingRequest
}

export interface InterruptAgentSessionResponse {
  interrupted: boolean
  turn: AgentTurn | null
  session: AgentSession | null
}

export interface RuntimeSseEventBase {
  id: string
  sessionId: string
  turnId?: string | null
  createdAt: string
}

export type RuntimeSseEvent =
  | (RuntimeSseEventBase & {
      type: 'session.snapshot'
      detail: AgentSessionDetail
    })
  | (RuntimeSseEventBase & {
      type: 'session.updated'
      session: AgentSession
    })
  | (RuntimeSseEventBase & {
      type: 'turn.started' | 'turn.completed' | 'turn.failed' | 'turn.interrupted'
      turn: AgentTurn
    })
  | (RuntimeSseEventBase & {
      type: 'message.created' | 'message.delta' | 'message.completed'
      message: AgentMessage
      delta?: string
    })
  | (RuntimeSseEventBase & {
      type: 'request.opened' | 'request.resolved'
      request: AgentPendingRequest
    })
  | (RuntimeSseEventBase & {
      type: 'activity'
      eventType: string
      title: string
      summary?: string
      status?: string
    })
  | (RuntimeSseEventBase & {
      type: 'diff.updated'
      diff: AgentTurnDiff
    })
  | (RuntimeSseEventBase & {
      type: 'artifact.created' | 'artifact.updated'
      artifact: AgentArtifact
    })
  | (RuntimeSseEventBase & {
      type: 'runtime.error'
      message: string
    })

export interface ApiErrorResponse {
  error: {
    code: string
    message: string
  }
}
