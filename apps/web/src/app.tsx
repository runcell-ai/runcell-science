import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AgentEvent,
  AgentPendingRequest,
  AgentProvider,
  AgentSession,
  AgentSessionDetail,
  AgentSessionSummary,
  AgentSessionWorktreeDiffResponse,
  AgentSessionWorktreeDiffStatusResponse,
  AgentTurnDiff,
  AgentTurn,
  CreateAgentSessionResponse,
  CreateAgentTurnResponse,
  InterruptAgentSessionResponse,
  ListAgentSessionsResponse,
  ResolveAgentRequestResponse,
  RuntimeSseEvent
} from '@open-science/contracts'
import {
  AgentConversationHeader,
  AgentDiffView,
  AgentErrorBanner,
  AgentPromptComposer,
  AgentRuntimeConfig,
  AgentSessionSidebar,
  AgentTimeline,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  TooltipProvider,
  displaySessionTitle,
  providerLabel
} from '@open-science/ui'
import type { AgentProviderOption, AgentTimelineItem } from '@open-science/ui'
import './app.css'

type RuntimeActivityEvent = Extract<RuntimeSseEvent, { type: 'activity' }>
type WorktreeDiffStatus = 'unknown' | 'checking' | 'available' | 'unavailable'

const apiBaseUrl = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '').replace(/\/$/, '')
const envDefaultCwd = (import.meta.env.VITE_AGENT_DEFAULT_CWD as string | undefined) ?? ''

const providerOptions: AgentProviderOption[] = [
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
  'diff.updated',
  'runtime.error'
]

const hiddenActivityEventTypes = new Set([
  'account/rateLimits/updated',
  'mcpServer/startupStatus/updated',
  'remoteControl/status/changed',
  'skills/changed',
  'thread/started',
  'thread/status/changed',
  'thread/tokenUsage/updated',
  'turn/started',
  'diff.updated',
  'claude.rate_limit_event',
  'claude.stream.content_block_delta',
  'claude.stream.message_delta',
  'claude.stream.message_start',
  'claude.stream.message_stop',
  'claude.system.init',
  'claude.system.status'
])

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

function byDiffUpdatedAt(items: AgentTurnDiff[]): AgentTurnDiff[] {
  return [...items].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
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

function isVisibleActivityEvent(eventType: string): boolean {
  return eventType !== 'stderr' && eventType !== 'content.delta' && !hiddenActivityEventTypes.has(eventType)
}

function visibleActivitySummary(summary: string | undefined): string | undefined {
  const trimmed = summary?.trim()
  if (!trimmed || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return undefined
  }
  return summary
}

function eventFromRuntimeActivity(event: RuntimeActivityEvent, provider: AgentProvider): AgentEvent | null {
  if (!isVisibleActivityEvent(event.eventType)) {
    return null
  }

  return {
    id: event.id,
    sessionId: event.sessionId,
    turnId: event.turnId ?? null,
    provider,
    eventType: event.eventType,
    streamKind: null,
    title: event.title,
    summary: visibleActivitySummary(event.summary) ?? null,
    status: event.status ?? null,
    createdAt: event.createdAt
  }
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
    case 'activity': {
      const activityEvent = eventFromRuntimeActivity(event, detail.session.provider)
      if (!activityEvent) {
        return detail
      }
      return {
        ...detail,
        events: byCreatedAt(upsertById(detail.events, activityEvent))
      }
    }
    case 'diff.updated':
      return {
        ...detail,
        diffs: byDiffUpdatedAt(upsertById(detail.diffs ?? [], event.diff))
      }
    default:
      return detail
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

function timelineItemRank(item: AgentTimelineItem): number {
  if (item.type === 'message') {
    if (item.message.role === 'user') {
      return 0
    }
    return 4
  }
  if (item.type === 'activity') {
    if (item.event.status === 'completed' || item.event.status === 'resolved') {
      return 2
    }
    return 1
  }
  if (item.type === 'diff') {
    return 3
  }
  return 3
}

function buildTimelineItems(detail: AgentSessionDetail | null): AgentTimelineItem[] {
  if (!detail) {
    return []
  }

  const items: AgentTimelineItem[] = [
    ...detail.messages.map((message) => ({
      id: message.id,
      type: 'message' as const,
      createdAt: message.createdAt,
      message
    })),
    ...detail.events.filter((event) => isVisibleActivityEvent(event.eventType)).map((event) => ({
      id: event.id,
      type: 'activity' as const,
      createdAt: event.createdAt,
      event
    })),
    ...(detail.diffs ?? []).map((diff) => ({
      id: diff.id,
      type: 'diff' as const,
      createdAt: diff.updatedAt,
      diff
    })),
    ...detail.pendingRequests.map((request) => ({
      id: request.id,
      type: 'request' as const,
      createdAt: request.createdAt,
      request
    }))
  ]

  return items.sort((left, right) => {
    const createdOrder = left.createdAt.localeCompare(right.createdAt)
    if (createdOrder !== 0) {
      return createdOrder
    }

    const rankOrder = timelineItemRank(left) - timelineItemRank(right)
    if (rankOrder !== 0) {
      return rankOrder
    }

    return left.id.localeCompare(right.id)
  })
}

function App() {
  const isNarrow = useIsNarrow()
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [activeDetail, setActiveDetail] = useState<AgentSessionDetail | null>(null)
  const [provider, setProvider] = useState<AgentProvider>('codex')
  const [cwd, setCwd] = useState(readStoredCwd)
  const [messageDraft, setMessageDraft] = useState('')
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'live' | 'error'>('idle')
  const [worktreeDiffStatus, setWorktreeDiffStatus] = useState<WorktreeDiffStatus>('unknown')
  const [worktreeDiffOpen, setWorktreeDiffOpen] = useState(false)
  const [worktreeDiff, setWorktreeDiff] = useState<AgentSessionWorktreeDiffResponse | null>(null)
  const [isLoadingWorktreeDiff, setIsLoadingWorktreeDiff] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [isResolvingRequestId, setIsResolvingRequestId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const isDraft = activeSessionId === null
  const running = isRunning(activeDetail)
  const timelineItems = useMemo(() => buildTimelineItems(activeDetail), [activeDetail])

  const loadSessions = useCallback(async () => {
    const response = await requestJson<ListAgentSessionsResponse>('/api/sessions')
    setSessions(response.sessions)
  }, [])

  const openSession = useCallback(async (sessionId: string) => {
    setErrorMessage(null)
    setConnectionStatus('connecting')
    setWorktreeDiffStatus('checking')
    setWorktreeDiffOpen(false)
    setWorktreeDiff(null)
    setActiveSessionId(sessionId)
    const [detail, diffStatus] = await Promise.all([
      requestJson<AgentSessionDetail>(`/api/sessions/${sessionId}`),
      requestJson<AgentSessionWorktreeDiffStatusResponse>(`/api/sessions/${sessionId}/worktree-diff/status`).catch(
        () => ({ isGitRepository: false })
      )
    ])
    setActiveDetail(detail)
    setWorktreeDiffStatus(diffStatus.isGitRepository ? 'available' : 'unavailable')
  }, [])

  const startDraft = useCallback(() => {
    setActiveSessionId(null)
    setActiveDetail(null)
    setConnectionStatus('idle')
    setWorktreeDiffStatus('unknown')
    setWorktreeDiffOpen(false)
    setWorktreeDiff(null)
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
        setActiveDetail(response.detail)
        setActiveSessionId(response.sessionId)
        setWorktreeDiffStatus('checking')
        const diffStatus = await requestJson<AgentSessionWorktreeDiffStatusResponse>(
          `/api/sessions/${response.sessionId}/worktree-diff/status`
        ).catch(() => ({ isGitRepository: false }))
        setWorktreeDiffStatus(diffStatus.isGitRepository ? 'available' : 'unavailable')
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

  const openWorktreeDiff = useCallback(async () => {
    if (!activeSessionId || worktreeDiffStatus !== 'available') {
      return
    }

    setErrorMessage(null)
    setWorktreeDiffOpen(true)
    setIsLoadingWorktreeDiff(true)
    try {
      const response = await requestJson<AgentSessionWorktreeDiffResponse>(
        `/api/sessions/${activeSessionId}/worktree-diff`
      )
      if (!response.isGitRepository) {
        setWorktreeDiffStatus('unavailable')
        setWorktreeDiff(null)
        setWorktreeDiffOpen(false)
        return
      }
      setWorktreeDiff(response)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setIsLoadingWorktreeDiff(false)
    }
  }, [activeSessionId, worktreeDiffStatus])

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
            <AgentSessionSidebar
              sessions={sessions}
              activeSessionId={activeSessionId}
              onRefresh={() => void loadSessions()}
              onStartDraft={startDraft}
              onOpenSession={(sessionId) => void openSession(sessionId)}
            />
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={78} minSize={48} className="panel chat-panel">
            <AgentConversationHeader
              title={activeTitle}
              providerLabel={activeDetail ? providerLabel(activeDetail.session.provider) : providerLabel(provider)}
              status={activeDetail ? activeDetail.session.status : 'draft'}
              connectionStatus={activeSessionId ? connectionStatus : null}
              running={running}
              showDiffButton={worktreeDiffStatus === 'available'}
              diffButtonDisabled={isLoadingWorktreeDiff}
              onOpenDiff={() => void openWorktreeDiff()}
              onInterrupt={() => void interruptSession()}
            />

            <AgentRuntimeConfig
              providerOptions={providerOptions}
              selectedProvider={activeDetail?.session.provider ?? provider}
              isDraft={isDraft}
              isSending={isSending}
              cwd={cwd}
              activeCwd={activeDetail?.session.cwd}
              onProviderChange={setProvider}
              onCwdChange={updateCwd}
            />

            <AgentErrorBanner message={errorMessage} />

            <AgentTimeline
              items={timelineItems}
              running={running}
              resolvingRequestId={isResolvingRequestId}
              onResolveRequest={(request, decision) => void resolveRequest(request, decision)}
            />

            <AgentPromptComposer
              value={messageDraft}
              canSend={canSend}
              isSending={isSending}
              disabled={isSending || running}
              onValueChange={setMessageDraft}
              onSubmit={() => void sendMessage()}
            />

            <Sheet open={worktreeDiffOpen} onOpenChange={setWorktreeDiffOpen}>
              <SheetContent className="worktree-diff-sheet">
                <SheetHeader>
                  <SheetTitle>Project diff</SheetTitle>
                  <SheetDescription>{activeDetail?.session.cwd ?? cwd}</SheetDescription>
                </SheetHeader>
                <div className="worktree-diff-body">
                  {isLoadingWorktreeDiff ? (
                    <div className="diff-empty">Loading diff</div>
                  ) : worktreeDiff?.unifiedDiff?.trim() ? (
                    <AgentDiffView title="Project changes" diff={{ files: [], unifiedDiff: worktreeDiff.unifiedDiff }} />
                  ) : (
                    <div className="diff-empty">No diff content</div>
                  )}
                </div>
              </SheetContent>
            </Sheet>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </TooltipProvider>
  )
}

export default App
