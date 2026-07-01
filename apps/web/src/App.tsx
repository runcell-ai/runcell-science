import { useCallback, useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react'
import type {
  AgentMessage,
  AgentPendingRequest,
  AgentProvider,
  AgentSession,
  AgentSessionDetail,
  AgentSessionStatus,
  AgentSessionSummary,
  AgentTurn,
  CreateAgentSessionResponse,
  CreateAgentTurnResponse,
  InterruptAgentSessionResponse,
  ListAgentSessionsResponse,
  ResolveAgentRequestResponse,
  RuntimeSseEvent
} from '@open-science/contracts'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  CircleDot,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Square,
  Terminal,
  UserRound
} from 'lucide-react'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import './App.css'

type ActivityItem = {
  id: string
  title: string
  summary?: string
  status?: string
  createdAt: string
}

type ProviderOption = {
  value: AgentProvider
  label: string
}

const apiBaseUrl = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '').replace(/\/$/, '')
const envDefaultCwd = (import.meta.env.VITE_AGENT_DEFAULT_CWD as string | undefined) ?? ''

const providerOptions: ProviderOption[] = [
  { value: 'codex', label: 'Codex' },
  { value: 'claude', label: 'Claude Code' }
]

const runtimeEventTypes: RuntimeSseEvent['type'][] = [
  'session.snapshot',
  'session.updated',
  'turn.started',
  'turn.completed',
  'turn.failed',
  'turn.interrupted',
  'message.created',
  'message.delta',
  'message.completed',
  'request.opened',
  'request.resolved',
  'activity',
  'runtime.error'
]

function apiUrl(path: string): string {
  return `${apiBaseUrl}${path}`
}

function readStoredCwd(): string {
  try {
    return window.localStorage.getItem('open-science.cwd') ?? envDefaultCwd
  } catch {
    return envDefaultCwd
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
    const message =
      body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object'
        ? String((body.error as { message?: unknown }).message ?? response.statusText)
        : response.statusText
    throw new Error(message)
  }
  return body as T
}

function useIsNarrow(): boolean {
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia('(max-width: 960px)').matches)

  useEffect(() => {
    const media = window.matchMedia('(max-width: 960px)')
    const update = () => setIsNarrow(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return isNarrow
}

function byCreatedAt<T extends { createdAt: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

function byRequestedAt(items: AgentTurn[]): AgentTurn[] {
  return [...items].sort((left, right) => left.requestedAt.localeCompare(right.requestedAt))
}

function upsertById<T extends { id: string }>(items: T[], next: T): T[] {
  const index = items.findIndex((item) => item.id === next.id)
  if (index === -1) {
    return [...items, next]
  }
  const updated = [...items]
  updated[index] = next
  return updated
}

function upsertSessionSummary(items: AgentSessionSummary[], session: AgentSession): AgentSessionSummary[] {
  if (!session.activatedAt || session.status === 'pending_activation') {
    return items
  }

  const summary: AgentSessionSummary = {
    id: session.id,
    provider: session.provider,
    title: session.title,
    cwd: session.cwd,
    model: session.model,
    runtimeMode: session.runtimeMode,
    status: session.status,
    activatedAt: session.activatedAt,
    updatedAt: session.updatedAt
  }

  return upsertById(items, summary).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

function applyRuntimeEvent(detail: AgentSessionDetail | null, event: RuntimeSseEvent): AgentSessionDetail | null {
  if (event.type === 'session.snapshot') {
    return event.detail
  }

  if (!detail || detail.session.id !== event.sessionId) {
    return detail
  }

  switch (event.type) {
    case 'session.updated':
      return {
        ...detail,
        session: event.session
      }
    case 'turn.started':
    case 'turn.completed':
    case 'turn.failed':
    case 'turn.interrupted':
      return {
        ...detail,
        turns: byRequestedAt(upsertById(detail.turns, event.turn))
      }
    case 'message.created':
    case 'message.delta':
    case 'message.completed':
      return {
        ...detail,
        messages: byCreatedAt(upsertById(detail.messages, event.message))
      }
    case 'request.opened':
    case 'request.resolved':
      return {
        ...detail,
        pendingRequests: byCreatedAt(upsertById(detail.pendingRequests, event.request))
      }
    default:
      return detail
  }
}

function activityFromEvent(event: RuntimeSseEvent): ActivityItem | null {
  switch (event.type) {
    case 'activity':
      if (event.eventType === 'stderr') {
        return null
      }
      return {
        id: event.id,
        title: event.title,
        summary: visibleActivitySummary(event.summary),
        status: event.status,
        createdAt: event.createdAt
      }
    case 'turn.started':
      return {
        id: event.id,
        title: 'Turn started',
        status: event.turn.status,
        createdAt: event.createdAt
      }
    case 'turn.completed':
      return {
        id: event.id,
        title: 'Turn completed',
        status: event.turn.status,
        createdAt: event.createdAt
      }
    case 'turn.failed':
      return {
        id: event.id,
        title: 'Turn failed',
        summary: event.turn.error ?? undefined,
        status: event.turn.status,
        createdAt: event.createdAt
      }
    case 'turn.interrupted':
      return {
        id: event.id,
        title: 'Turn interrupted',
        status: event.turn.status,
        createdAt: event.createdAt
      }
    case 'request.opened':
      return {
        id: event.id,
        title: event.request.title ?? event.request.type,
        status: event.request.status,
        createdAt: event.createdAt
      }
    case 'request.resolved':
      return {
        id: event.id,
        title: event.request.title ?? event.request.type,
        status: event.request.status,
        createdAt: event.createdAt
      }
    case 'runtime.error':
      return {
        id: event.id,
        title: 'Runtime error',
        summary: event.message,
        status: 'error',
        createdAt: event.createdAt
      }
    default:
      return null
  }
}

function visibleActivitySummary(summary: string | undefined): string | undefined {
  const trimmed = summary?.trim()
  if (!trimmed || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return undefined
  }
  return summary
}

function providerLabel(provider: AgentProvider): string {
  return providerOptions.find((option) => option.value === provider)?.label ?? provider
}

function statusLabel(status: AgentSessionStatus | AgentTurn['status'] | string): string {
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

function isRunning(detail: AgentSessionDetail | null): boolean {
  return Boolean(
    detail &&
      (detail.session.status === 'running' ||
        detail.session.status === 'waiting' ||
        detail.turns.some((turn) => turn.status === 'running'))
  )
}

function displaySessionTitle(session: AgentSessionSummary | AgentSessionDetail['session']): string {
  return session.title?.trim() || `${providerLabel(session.provider)} session`
}

function compactText(value: string, maxLength = 88): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength - 1)}...`
}

function PanelTitle({ label }: { label: string }) {
  return <h2 className="panel-title">{label}</h2>
}

function StatusPill({ status }: { status: string }) {
  return <span className={`status-pill status-${status}`}>{statusLabel(status)}</span>
}

function ActivityIcon({ item }: { item: ActivityItem }) {
  if (item.status === 'completed' || item.status === 'resolved') {
    return <CheckCircle2 className="activity-icon activity-icon-success" />
  }
  if (item.status === 'failed' || item.status === 'error') {
    return <AlertTriangle className="activity-icon activity-icon-error" />
  }
  if (item.status === 'running' || item.status === 'started' || item.status === 'open') {
    return <Loader2 className="activity-icon activity-icon-running" />
  }
  return <Terminal className="activity-icon" />
}

function MessageIcon({ role }: { role: AgentMessage['role'] }) {
  if (role === 'assistant') {
    return <Bot className="message-icon" />
  }
  return <UserRound className="message-icon" />
}

function App() {
  const isNarrow = useIsNarrow()
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [activeDetail, setActiveDetail] = useState<AgentSessionDetail | null>(null)
  const [provider, setProvider] = useState<AgentProvider>('codex')
  const [cwd, setCwd] = useState(readStoredCwd)
  const [messageDraft, setMessageDraft] = useState('')
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'live' | 'error'>('idle')
  const [isSending, setIsSending] = useState(false)
  const [isResolvingRequestId, setIsResolvingRequestId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const isDraft = activeSessionId === null
  const running = isRunning(activeDetail)
  const sortedMessages = useMemo(() => byCreatedAt(activeDetail?.messages ?? []), [activeDetail?.messages])
  const openRequests = useMemo(
    () => (activeDetail?.pendingRequests ?? []).filter((request) => request.status === 'open'),
    [activeDetail?.pendingRequests]
  )

  const loadSessions = useCallback(async () => {
    const response = await requestJson<ListAgentSessionsResponse>('/api/sessions')
    setSessions(response.sessions)
  }, [])

  const openSession = useCallback(async (sessionId: string) => {
    setErrorMessage(null)
    setConnectionStatus('connecting')
    setActiveSessionId(sessionId)
    setActivities([])
    const detail = await requestJson<AgentSessionDetail>(`/api/sessions/${sessionId}`)
    setActiveDetail(detail)
  }, [])

  const startDraft = useCallback(() => {
    setActiveSessionId(null)
    setActiveDetail(null)
    setActivities([])
    setConnectionStatus('idle')
    setErrorMessage(null)
    setMessageDraft('')
  }, [])

  const updateCwd = useCallback((value: string) => {
    setCwd(value)
    try {
      window.localStorage.setItem('open-science.cwd', value)
    } catch {
      return
    }
  }, [])

  useEffect(() => {
    void loadSessions().catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    })
  }, [loadSessions])

  useEffect(() => {
    if (!activeSessionId) {
      return
    }

    setConnectionStatus('connecting')
    const source = new EventSource(apiUrl(`/api/sessions/${activeSessionId}/events`))
    const handleEvent = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as RuntimeSseEvent
      setActiveDetail((detail) => applyRuntimeEvent(detail, event))

      const activity = activityFromEvent(event)
      if (activity) {
        setActivities((items) => [...items, activity].slice(-80))
      }

      if (event.type === 'session.updated') {
        setSessions((items) => upsertSessionSummary(items, event.session))
        return
      }

      if (event.type === 'turn.completed' || event.type === 'turn.failed' || event.type === 'turn.interrupted') {
        void loadSessions().catch(() => undefined)
      }
    }

    runtimeEventTypes.forEach((type) => source.addEventListener(type, handleEvent as EventListener))
    source.onopen = () => setConnectionStatus('live')
    source.onerror = () => setConnectionStatus('error')

    return () => {
      runtimeEventTypes.forEach((type) => source.removeEventListener(type, handleEvent as EventListener))
      source.close()
    }
  }, [activeSessionId, loadSessions])

  const sendMessage = useCallback(async () => {
    const text = messageDraft.trim()
    if (!text || isSending || running) {
      return
    }

    setIsSending(true)
    setErrorMessage(null)
    try {
      if (isDraft) {
        const response = await requestJson<CreateAgentSessionResponse>('/api/sessions', {
          method: 'POST',
          body: JSON.stringify({
            provider,
            cwd: cwd.trim(),
            initialMessage: text,
            runtimeMode: 'full_access'
          })
        })
        setMessageDraft('')
        setActivities([])
        setActiveDetail(response.detail)
        setActiveSessionId(response.sessionId)
      } else if (activeSessionId) {
        await requestJson<CreateAgentTurnResponse>(`/api/sessions/${activeSessionId}/turns`, {
          method: 'POST',
          body: JSON.stringify({ message: text })
        })
        setMessageDraft('')
        const detail = await requestJson<AgentSessionDetail>(`/api/sessions/${activeSessionId}`)
        setActiveDetail(detail)
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSending(false)
    }
  }, [activeSessionId, cwd, isDraft, isSending, messageDraft, provider, running])

  const submitMessage = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      void sendMessage()
    },
    [sendMessage]
  )

  const handleDraftKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void sendMessage()
      }
    },
    [sendMessage]
  )

  const interruptSession = useCallback(async () => {
    if (!activeSessionId || !running) {
      return
    }

    setErrorMessage(null)
    try {
      await requestJson<InterruptAgentSessionResponse>(`/api/sessions/${activeSessionId}/interrupt`, {
        method: 'POST'
      })
      const detail = await requestJson<AgentSessionDetail>(`/api/sessions/${activeSessionId}`)
      setActiveDetail(detail)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }, [activeSessionId, running])

  const resolveRequest = useCallback(
    async (request: AgentPendingRequest, decision: 'allow' | 'deny') => {
      if (!activeSessionId) {
        return
      }
      setIsResolvingRequestId(request.id)
      setErrorMessage(null)
      try {
        await requestJson<ResolveAgentRequestResponse>(
          `/api/sessions/${activeSessionId}/requests/${request.id}/resolve`,
          {
            method: 'POST',
            body: JSON.stringify({ decision })
          }
        )
        const detail = await requestJson<AgentSessionDetail>(`/api/sessions/${activeSessionId}`)
        setActiveDetail(detail)
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error))
      } finally {
        setIsResolvingRequestId(null)
      }
    },
    [activeSessionId]
  )

  const canSend = messageDraft.trim().length > 0 && !isSending && !running && (!isDraft || cwd.trim().length > 0)
  const activeTitle = activeDetail ? displaySessionTitle(activeDetail.session) : 'Draft conversation'

  return (
    <TooltipProvider>
      <div className="app-shell">
        <ResizablePanelGroup direction={isNarrow ? 'vertical' : 'horizontal'} className="shell-grid">
          <ResizablePanel defaultSize={22} minSize={16} maxSize={32} className="panel sessions-panel">
            <div className="panel-heading-row">
              <PanelTitle label="Sessions" />
              <div className="panel-actions">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="icon-sm" onClick={() => void loadSessions()}>
                      <RefreshCw />
                      <span className="sr-only">Refresh sessions</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Refresh sessions</TooltipContent>
                </Tooltip>
                <Button className="primary-action" onClick={startDraft}>
                  <Plus />
                  New
                </Button>
              </div>
            </div>

            <ScrollArea className="panel-scroll">
              <div className="session-list">
                {sessions.length === 0 ? (
                  <div className="panel-empty-state">No sessions</div>
                ) : (
                  sessions.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      className={`session-item ${session.id === activeSessionId ? 'is-active' : ''}`}
                      onClick={() => void openSession(session.id)}
                    >
                      <span className="session-title">{displaySessionTitle(session)}</span>
                      <span className="session-meta">
                        <span>{providerLabel(session.provider)}</span>
                        <StatusPill status={session.status} />
                      </span>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={48} minSize={36} className="panel chat-panel">
            <div className="conversation-header">
              <div className="conversation-title-group">
                <h1 className="conversation-title">{activeTitle}</h1>
                <div className="conversation-meta">
                  {activeDetail ? providerLabel(activeDetail.session.provider) : providerLabel(provider)}
                  {activeDetail ? <StatusPill status={activeDetail.session.status} /> : <StatusPill status="draft" />}
                  {activeSessionId ? (
                    <span className={`connection-dot connection-${connectionStatus}`}>
                      <CircleDot />
                      {connectionStatus === 'live' ? 'Live' : statusLabel(connectionStatus)}
                    </span>
                  ) : null}
                </div>
              </div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      onClick={() => void interruptSession()}
                      disabled={!running}
                    >
                      <Square />
                      <span className="sr-only">Interrupt turn</span>
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Interrupt turn</TooltipContent>
              </Tooltip>
            </div>

            <div className="runtime-config">
              <div className="field-block">
                <span className="field-label">Provider</span>
                <div className="segmented-control">
                  {providerOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`segment-button ${
                        (activeDetail?.session.provider ?? provider) === option.value ? 'is-selected' : ''
                      }`}
                      onClick={() => setProvider(option.value)}
                      disabled={!isDraft || isSending}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field-block cwd-field">
                <span className="field-label">Working directory</span>
                {isDraft ? (
                  <Input value={cwd} onChange={(event) => updateCwd(event.target.value)} placeholder="/path/to/project" />
                ) : (
                  <div className="readonly-path">{activeDetail?.session.cwd}</div>
                )}
              </div>
            </div>

            {errorMessage ? (
              <div className="error-banner">
                <AlertTriangle />
                <span>{errorMessage}</span>
              </div>
            ) : null}

            <ScrollArea className="chat-scroll">
              <div className="message-list">
                {sortedMessages.length === 0 ? (
                  <div className="chat-empty-state">No messages</div>
                ) : (
                  sortedMessages.map((message) => (
                    <article key={message.id} className={`message-row message-${message.role}`}>
                      <div className="message-avatar">
                        <MessageIcon role={message.role} />
                      </div>
                      <div className="message-body">
                        <div className="message-heading">
                          <span>{message.role === 'assistant' ? 'Assistant' : 'User'}</span>
                          <span>{statusLabel(message.status)}</span>
                        </div>
                        <p>{message.text}</p>
                      </div>
                    </article>
                  ))
                )}
                {running ? (
                  <div className="running-row">
                    <Loader2 />
                    <span>Running</span>
                  </div>
                ) : null}
              </div>
            </ScrollArea>

            <form className="composer" onSubmit={submitMessage}>
              <Textarea
                rows={3}
                placeholder="Message"
                value={messageDraft}
                onChange={(event) => setMessageDraft(event.target.value)}
                onKeyDown={handleDraftKeyDown}
                disabled={isSending || running}
              />
              <Button className="primary-action send-button" type="submit" disabled={!canSend}>
                {isSending ? <Loader2 className="spin-icon" /> : <Send />}
                Send
              </Button>
            </form>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={30} minSize={24} className="panel activity-panel">
            <PanelTitle label="Activity" />

            {openRequests.length > 0 ? (
              <div className="request-stack">
                {openRequests.map((request) => (
                  <div key={request.id} className="request-bar">
                    <div>
                      <span className="request-title">{request.title ?? request.type}</span>
                      <span className="request-status">{statusLabel(request.status)}</span>
                    </div>
                    <div className="request-actions">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isResolvingRequestId === request.id}
                        onClick={() => void resolveRequest(request, 'deny')}
                      >
                        Deny
                      </Button>
                      <Button
                        className="primary-action"
                        size="sm"
                        disabled={isResolvingRequestId === request.id}
                        onClick={() => void resolveRequest(request, 'allow')}
                      >
                        Allow
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <Separator className="activity-separator" />

            <ScrollArea className="activity-scroll">
              <div className="activity-list">
                {activities.length === 0 ? (
                  <div className="panel-empty-state">No live activity</div>
                ) : (
                  activities.map((item) => (
                    <div key={item.id} className="activity-item">
                      <ActivityIcon item={item} />
                      <div className="activity-copy">
                        <div className="activity-title-row">
                          <span>{item.title}</span>
                          {item.status ? <StatusPill status={item.status} /> : null}
                        </div>
                        {item.summary ? <p>{compactText(item.summary, 140)}</p> : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </TooltipProvider>
  )
}

export default App
