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
  disabledMcpServers: string[]
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

/**
 * A file discovered on disk inside a session's working directory. Workspace
 * files and session artifacts are surfaced together in the artifacts browser:
 * artifacts are files the agent chose to highlight, workspace files are
 * everything else the user can still open.
 */
export type WorkspaceFileKind = 'image' | 'pdf' | 'markdown' | 'html' | 'text' | 'other'

export interface WorkspaceFile {
  /** Path relative to the session cwd, using forward slashes. */
  path: string
  name: string
  kind: WorkspaceFileKind
  size: number
  modifiedAt: string
}

export interface ListWorkspaceFilesResponse {
  root: string
  isDirectory: boolean
  files: WorkspaceFile[]
  /** True when the walk hit its cap and some files were omitted. */
  truncated: boolean
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

export type McpTransport = 'stdio' | 'http' | 'sse'

export type McpScope = 'user' | 'project' | 'local'

export type McpServerStatusKind = 'connected' | 'failed' | 'needs_auth' | 'pending' | 'disabled' | 'unknown'

export interface McpServerToolSummary {
  name: string
  description: string | null
}

export interface McpServerView {
  key: string
  name: string
  provider: AgentProvider
  scope: McpScope
  transport: McpTransport
  command: string | null
  args: string[]
  url: string | null
  enabled: boolean
  status: McpServerStatusKind
  statusDetail: string | null
  tools: McpServerToolSummary[]
  source: string
}

export interface ListMcpServersResponse {
  servers: McpServerView[]
  warnings: string[]
}

export interface McpServerConfigInput {
  type?: McpTransport
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

export interface AddMcpServerRequest {
  provider: AgentProvider
  name: string
  config: McpServerConfigInput
}

export interface RemoveMcpServerRequest {
  provider: AgentProvider
  scope: McpScope
  name: string
  cwd?: string
}

export interface SetMcpServerEnabledRequest {
  enabled: boolean
}

export interface MutateMcpServerResponse {
  ok: boolean
}

export interface ImportMcpServersRequest {
  json: string
  providers: AgentProvider[]
}

export interface ImportMcpServersResponse {
  added: string[]
  skipped: string[]
  errors: string[]
}

export interface McpOauthLoginResponse {
  authorizationUrl: string
}

export type SkillScopeKind = 'user' | 'repo' | 'system' | 'admin' | 'builtin'

export interface SkillView {
  provider: AgentProvider
  name: string
  description: string | null
  path: string | null
  scope: SkillScopeKind
  enabled: boolean
}

export interface ListSkillsResponse {
  skills: SkillView[]
  warnings: string[]
}

export interface ImportSkillRequest {
  name: string
  content: string
  providers: AgentProvider[]
}

export interface ImportSkillResponse {
  written: string[]
  skipped: string[]
}

export interface SetSkillEnabledRequest {
  name?: string
  path?: string
  enabled: boolean
}

export interface UpdateSessionConnectorsRequest {
  disabledServers: string[]
}
