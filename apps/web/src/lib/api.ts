import type {
  AgentArtifactStateResponse,
  AgentProviderControlTokenResponse,
  AgentProviderLoginAttemptResponse,
  AgentProviderSetupInput,
  AgentProviderSnapshotResponse,
  AgentSessionDetail,
  AgentSessionWorktreeDiffResponse,
  AgentSessionWorktreeDiffStatusResponse,
  CreateAgentArtifactRequest,
  CreateAgentArtifactResponse,
  CreateAgentSessionRequest,
  CreateAgentSessionResponse,
  CreateAgentTurnResponse,
  InterruptAgentSessionResponse,
  AddMcpServerRequest,
  ImportMcpServersRequest,
  ImportMcpServersResponse,
  ImportSkillRequest,
  ImportSkillResponse,
  ListBundledScienceConnectorsResponse,
  ListAgentProviderInstancesResponse,
  ListAgentModelsResponse,
  ListAgentSessionsResponse,
  ListMcpServersResponse,
  ListSkillsResponse,
  McpOauthLoginResponse,
  MutateMcpServerResponse,
  RemoveMcpServerRequest,
  ResolveAgentRequestRequest,
  ResolveAgentRequestResponse
} from '@runcell-science/contracts'

export const apiBaseUrl = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '').replace(/\/$/, '')

function apiUrl(path: string): string {
  return `${apiBaseUrl}${path}`
}

export class ApiRequestError extends Error {
  readonly status: number
  readonly code: string | null

  constructor(
    message: string,
    status: number,
    code: string | null
  ) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {})
    }
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const errorCode =
      body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object'
        ? String((body.error as { code?: unknown }).code ?? '')
        : ''
    const message =
      body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object'
        ? String((body.error as { message?: unknown }).message ?? response.statusText)
        : response.statusText
    throw new ApiRequestError(message, response.status, errorCode || null)
  }
  return body as T
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const api = {
  getAgentProviderControlToken: () =>
    requestJson<AgentProviderControlTokenResponse>('/api/agent-provider-control/token'),

  listAgentProviderInstances: (token: string) =>
    requestJson<ListAgentProviderInstancesResponse>('/api/agent-provider-instances', {
      headers: { 'x-runcell-control-token': token }
    }),

  refreshAgentProvider: (token: string, instanceId: string) =>
    requestJson<AgentProviderSnapshotResponse>(
      `/api/agent-provider-instances/${encodeURIComponent(instanceId)}/refresh`,
      {
        method: 'POST',
        headers: { 'x-runcell-control-token': token },
        body: JSON.stringify({})
      }
    ),

  testAgentProviderSetup: (token: string, instanceId: string, input: AgentProviderSetupInput) =>
    requestJson<AgentProviderSnapshotResponse>(
      `/api/agent-provider-instances/${encodeURIComponent(instanceId)}/setup/test`,
      {
        method: 'POST',
        headers: { 'x-runcell-control-token': token },
        body: JSON.stringify(input)
      }
    ),

  saveAgentProviderSetup: (token: string, instanceId: string, input: AgentProviderSetupInput) =>
    requestJson<AgentProviderSnapshotResponse>(
      `/api/agent-provider-instances/${encodeURIComponent(instanceId)}/setup`,
      {
        method: 'PUT',
        headers: { 'x-runcell-control-token': token },
        body: JSON.stringify(input)
      }
    ),

  resetAgentProviderSetup: (token: string, instanceId: string) =>
    requestJson<AgentProviderSnapshotResponse>(
      `/api/agent-provider-instances/${encodeURIComponent(instanceId)}/setup`,
      {
        method: 'DELETE',
        headers: { 'x-runcell-control-token': token },
        body: JSON.stringify({})
      }
    ),

  createAgentProviderLoginAttempt: (token: string, instanceId: string) =>
    requestJson<AgentProviderLoginAttemptResponse>(
      `/api/agent-provider-instances/${encodeURIComponent(instanceId)}/login-attempts`,
      {
        method: 'POST',
        headers: { 'x-runcell-control-token': token },
        body: JSON.stringify({})
      }
    ),

  getAgentProviderLoginAttempt: (
    token: string,
    instanceId: string,
    attemptId: string,
    signal?: AbortSignal
  ) =>
    requestJson<AgentProviderLoginAttemptResponse>(
      `/api/agent-provider-instances/${encodeURIComponent(instanceId)}/login-attempts/${encodeURIComponent(attemptId)}`,
      {
        headers: { 'x-runcell-control-token': token },
        signal
      }
    ),

  cancelAgentProviderLoginAttempt: (token: string, instanceId: string, attemptId: string) =>
    requestJson<AgentProviderLoginAttemptResponse>(
      `/api/agent-provider-instances/${encodeURIComponent(instanceId)}/login-attempts/${encodeURIComponent(attemptId)}/cancel`,
      {
        method: 'POST',
        headers: { 'x-runcell-control-token': token },
        body: JSON.stringify({})
      }
    ),

  listSessions: () => requestJson<ListAgentSessionsResponse>('/api/sessions'),

  listModels: () => requestJson<ListAgentModelsResponse>('/api/models'),

  getSessionDetail: (sessionId: string) => requestJson<AgentSessionDetail>(`/api/sessions/${sessionId}`),

  createSession: (input: CreateAgentSessionRequest) =>
    requestJson<CreateAgentSessionResponse>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(input)
    }),

  createTurn: (sessionId: string, message: string) =>
    requestJson<CreateAgentTurnResponse>(`/api/sessions/${sessionId}/turns`, {
      method: 'POST',
      body: JSON.stringify({ message })
    }),

  createArtifact: (sessionId: string, input: CreateAgentArtifactRequest) =>
    requestJson<CreateAgentArtifactResponse>(`/api/sessions/${sessionId}/artifacts`, {
      method: 'POST',
      body: JSON.stringify(input)
    }),

  getArtifactState: (sessionId: string, artifactId: string) =>
    requestJson<AgentArtifactStateResponse>(
      `/api/sessions/${sessionId}/artifacts/${encodeURIComponent(artifactId)}/state`
    ),

  putArtifactState: (sessionId: string, artifactId: string, state: unknown) =>
    requestJson<AgentArtifactStateResponse>(
      `/api/sessions/${sessionId}/artifacts/${encodeURIComponent(artifactId)}/state`,
      {
        method: 'PUT',
        body: JSON.stringify({ state })
      }
    ),

  interruptSession: (sessionId: string) =>
    requestJson<InterruptAgentSessionResponse>(`/api/sessions/${sessionId}/interrupt`, {
      method: 'POST'
    }),

  resolveRequest: (sessionId: string, requestId: string, resolution: ResolveAgentRequestRequest) =>
    requestJson<ResolveAgentRequestResponse>(`/api/sessions/${sessionId}/requests/${requestId}/resolve`, {
      method: 'POST',
      body: JSON.stringify(resolution)
    }),

  getWorktreeDiffStatus: (sessionId: string) =>
    requestJson<AgentSessionWorktreeDiffStatusResponse>(`/api/sessions/${sessionId}/worktree-diff/status`),

  getWorktreeDiff: (sessionId: string) =>
    requestJson<AgentSessionWorktreeDiffResponse>(`/api/sessions/${sessionId}/worktree-diff`),

  addMcpServer: (input: AddMcpServerRequest) =>
    requestJson<MutateMcpServerResponse>('/api/mcp/servers', {
      method: 'POST',
      body: JSON.stringify(input)
    }),

  removeMcpServer: (input: RemoveMcpServerRequest) =>
    requestJson<MutateMcpServerResponse>('/api/mcp/servers/remove', {
      method: 'POST',
      body: JSON.stringify(input)
    }),

  setMcpServerEnabled: (provider: string, name: string, enabled: boolean) =>
    requestJson<MutateMcpServerResponse>(`/api/mcp/servers/${provider}/${encodeURIComponent(name)}/enabled`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled })
    }),

  mcpOauthLogin: (provider: string, name: string) =>
    requestJson<McpOauthLoginResponse>(`/api/mcp/servers/${provider}/${encodeURIComponent(name)}/login`, {
      method: 'POST',
      body: JSON.stringify({})
    }),

  importMcpServers: (input: ImportMcpServersRequest) =>
    requestJson<ImportMcpServersResponse>('/api/mcp/import', {
      method: 'POST',
      body: JSON.stringify(input)
    }),

  listBundledConnectors: (input: { cwd: string }) => {
    const params = new URLSearchParams({ cwd: input.cwd })
    return requestJson<ListBundledScienceConnectorsResponse>(`/api/bundled-connectors?${params.toString()}`)
  },

  setBundledConnectorEnabled: (name: string, cwd: string, enabled: boolean) =>
    requestJson<MutateMcpServerResponse>(`/api/bundled-connectors/${encodeURIComponent(name)}/enabled`, {
      method: 'PATCH',
      body: JSON.stringify({ cwd, enabled })
    }),

  listSkills: (input: { provider: string; cwd?: string; sessionId?: string; refresh?: boolean }) => {
    const params = new URLSearchParams({ provider: input.provider })
    if (input.cwd) params.set('cwd', input.cwd)
    if (input.sessionId) params.set('sessionId', input.sessionId)
    if (input.refresh) params.set('refresh', 'true')
    return requestJson<ListSkillsResponse>(`/api/skills?${params.toString()}`)
  },

  importSkill: (input: ImportSkillRequest) =>
    requestJson<ImportSkillResponse>('/api/skills/import', {
      method: 'POST',
      body: JSON.stringify(input)
    }),

  setSkillEnabled: (selector: { name?: string; path?: string }, enabled: boolean) =>
    requestJson<MutateMcpServerResponse>('/api/skills/codex/enabled', {
      method: 'PATCH',
      body: JSON.stringify({ ...selector, enabled })
    }),

  listMcpServers: (input?: { cwd?: string; refresh?: boolean }) => {
    const params = new URLSearchParams()
    if (input?.cwd) params.set('cwd', input.cwd)
    if (input?.refresh) params.set('refresh', 'true')
    const query = params.toString()
    return requestJson<ListMcpServersResponse>(`/api/mcp/servers${query ? `?${query}` : ''}`)
  },

  updateSessionConnectors: (sessionId: string, disabledServers: string[]) =>
    requestJson<AgentSessionDetail>(`/api/sessions/${sessionId}/connectors`, {
      method: 'PATCH',
      body: JSON.stringify({ disabledServers })
    }),

  sessionEventsUrl: (sessionId: string) => apiUrl(`/api/sessions/${sessionId}/events`)
}
