import type {
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
  ListAgentSessionsResponse,
  ListMcpServersResponse,
  ListSkillsResponse,
  McpOauthLoginResponse,
  MutateMcpServerResponse,
  RemoveMcpServerRequest,
  ResolveAgentRequestResponse
} from '@open-science/contracts'

export const apiBaseUrl = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '').replace(/\/$/, '')

function apiUrl(path: string): string {
  return `${apiBaseUrl}${path}`
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
    const message =
      body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object'
        ? String((body.error as { message?: unknown }).message ?? response.statusText)
        : response.statusText
    throw new Error(message)
  }
  return body as T
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const api = {
  listSessions: () => requestJson<ListAgentSessionsResponse>('/api/sessions'),

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

  interruptSession: (sessionId: string) =>
    requestJson<InterruptAgentSessionResponse>(`/api/sessions/${sessionId}/interrupt`, {
      method: 'POST'
    }),

  resolveRequest: (sessionId: string, requestId: string, decision: 'allow' | 'deny') =>
    requestJson<ResolveAgentRequestResponse>(`/api/sessions/${sessionId}/requests/${requestId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ decision })
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

  setSkillEnabled: (name: string, enabled: boolean) =>
    requestJson<MutateMcpServerResponse>('/api/skills/codex/enabled', {
      method: 'PATCH',
      body: JSON.stringify({ name, enabled })
    }),

  listMcpServers: (input?: { cwd?: string; refresh?: boolean }) => {
    const params = new URLSearchParams()
    if (input?.cwd) params.set('cwd', input.cwd)
    if (input?.refresh) params.set('refresh', 'true')
    const query = params.toString()
    return requestJson<ListMcpServersResponse>(`/api/mcp/servers${query ? `?${query}` : ''}`)
  },

  sessionEventsUrl: (sessionId: string) => apiUrl(`/api/sessions/${sessionId}/events`)
}
