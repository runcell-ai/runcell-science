import { useMemo, useReducer, useState } from 'react'
import type { AgentArtifact, AgentPendingRequest, AgentProvider, RuntimeSseEvent } from '@open-science/contracts'
import { api, toErrorMessage } from '../lib/api'
import { buildTimelineItems, isRunning } from '../lib/session-events'
import { initialWorkspaceState, workspaceReducer } from '../lib/workspace-state'

export interface SendMessageConfig {
  provider: AgentProvider
  cwd: string
  model: string | null
}

/**
 * Owns the active-session workspace: session detail, side panels, worktree
 * diff, and the async flows that mutate them. All cross-cutting resets
 * (switching sessions, starting a draft) live in the reducer so they cannot
 * drift apart.
 */
export function useWorkspace() {
  const [state, dispatch] = useReducer(workspaceReducer, initialWorkspaceState)
  const [messageDraft, setMessageDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isCreatingArtifact, setIsCreatingArtifact] = useState(false)
  const [resolvingRequestId, setResolvingRequestId] = useState<string | null>(null)

  const running = isRunning(state.detail)
  const isDraft = state.activeSessionId === null
  const timelineItems = useMemo(
    () => buildTimelineItems(state.detail, state.activeArtifactId),
    [state.detail, state.activeArtifactId]
  )

  async function openSession(sessionId: string): Promise<void> {
    dispatch({ type: 'session-opened', sessionId })
    try {
      const [detail, diffStatus] = await Promise.all([
        api.getSessionDetail(sessionId),
        api.getWorktreeDiffStatus(sessionId).catch(() => ({ isGitRepository: false }))
      ])
      dispatch({ type: 'session-loaded', sessionId, detail })
      dispatch({ type: 'diff-availability-resolved', sessionId, available: diffStatus.isGitRepository })
    } catch (error) {
      dispatch({ type: 'session-load-failed', sessionId, message: toErrorMessage(error) })
    }
  }

  function startDraft(): void {
    dispatch({ type: 'draft-started' })
    setMessageDraft('')
  }

  async function sendMessage(config: SendMessageConfig): Promise<void> {
    const text = messageDraft.trim()
    if (!text || isSending || running) {
      return
    }

    setIsSending(true)
    dispatch({ type: 'error-cleared' })
    try {
      if (state.activeSessionId === null) {
        const response = await api.createSession({
          provider: config.provider,
          cwd: config.cwd.trim(),
          initialMessage: text,
          model: config.model,
          runtimeMode: 'full_access'
        })
        setMessageDraft('')
        dispatch({ type: 'draft-session-created', sessionId: response.sessionId, detail: response.detail })
        const diffStatus = await api
          .getWorktreeDiffStatus(response.sessionId)
          .catch(() => ({ isGitRepository: false }))
        dispatch({
          type: 'diff-availability-resolved',
          sessionId: response.sessionId,
          available: diffStatus.isGitRepository
        })
      } else {
        const sessionId = state.activeSessionId
        await api.createTurn(sessionId, text)
        setMessageDraft('')
        const detail = await api.getSessionDetail(sessionId)
        dispatch({ type: 'detail-refetched', sessionId, detail })
      }
    } catch (error) {
      dispatch({ type: 'operation-failed', message: toErrorMessage(error) })
    } finally {
      setIsSending(false)
    }
  }

  async function openWorktreeDiff(): Promise<void> {
    const sessionId = state.activeSessionId
    if (!sessionId || state.diffAvailability !== 'available') {
      return
    }

    dispatch({ type: 'diff-panel-opened' })
    try {
      const response = await api.getWorktreeDiff(sessionId)
      dispatch({ type: 'diff-loaded', sessionId, response })
    } catch (error) {
      dispatch({ type: 'diff-load-failed', sessionId, message: toErrorMessage(error) })
    }
  }

  async function createArtifact(value: string): Promise<void> {
    const sessionId = state.activeSessionId
    if (!sessionId || isCreatingArtifact) {
      return
    }

    const trimmed = value.trim()
    if (!trimmed) {
      return
    }

    setIsCreatingArtifact(true)
    dispatch({ type: 'error-cleared' })
    try {
      const isUrl = /^https?:\/\//i.test(trimmed)
      const response = await api.createArtifact(sessionId, isUrl ? { url: trimmed } : { path: trimmed })
      dispatch({ type: 'artifact-created', sessionId, artifact: response.artifact })
    } catch (error) {
      dispatch({ type: 'operation-failed', message: toErrorMessage(error) })
    } finally {
      setIsCreatingArtifact(false)
    }
  }

  async function interruptSession(): Promise<void> {
    const sessionId = state.activeSessionId
    if (!sessionId || !running) {
      return
    }

    dispatch({ type: 'error-cleared' })
    try {
      await api.interruptSession(sessionId)
      const detail = await api.getSessionDetail(sessionId)
      dispatch({ type: 'detail-refetched', sessionId, detail })
    } catch (error) {
      dispatch({ type: 'operation-failed', message: toErrorMessage(error) })
    }
  }

  async function resolveRequest(request: AgentPendingRequest, decision: 'allow' | 'deny'): Promise<void> {
    const sessionId = state.activeSessionId
    if (!sessionId) {
      return
    }

    setResolvingRequestId(request.id)
    dispatch({ type: 'error-cleared' })
    try {
      await api.resolveRequest(sessionId, request.id, decision)
      const detail = await api.getSessionDetail(sessionId)
      dispatch({ type: 'detail-refetched', sessionId, detail })
    } catch (error) {
      dispatch({ type: 'operation-failed', message: toErrorMessage(error) })
    } finally {
      setResolvingRequestId(null)
    }
  }

  return {
    activeSessionId: state.activeSessionId,
    detail: state.detail,
    diffAvailability: state.diffAvailability,
    worktreeDiff: state.worktreeDiff,
    isLoadingWorktreeDiff: state.isLoadingWorktreeDiff,
    sidePanel: state.sidePanel,
    activeArtifactId: state.activeArtifactId,
    artifactDraft: state.artifactDraft,
    errorMessage: state.errorMessage,
    notebookFocus: state.notebookFocus,
    isDraft,
    running,
    timelineItems,
    messageDraft,
    setMessageDraft,
    isSending,
    isCreatingArtifact,
    resolvingRequestId,
    openSession,
    startDraft,
    sendMessage,
    openWorktreeDiff,
    closeWorktreeDiff: () => dispatch({ type: 'diff-panel-closed' }),
    openArtifact: (artifact: AgentArtifact) => dispatch({ type: 'artifact-opened', artifactId: artifact.id }),
    openArtifactsPanel: () => dispatch({ type: 'artifacts-panel-opened' }),
    closeArtifactsPanel: () => dispatch({ type: 'artifacts-panel-closed' }),
    selectArtifact: (artifactId: string | null) => dispatch({ type: 'artifact-selected', artifactId }),
    setArtifactDraft: (value: string) => dispatch({ type: 'artifact-draft-changed', value }),
    createArtifact,
    interruptSession,
    resolveRequest,
    handleRuntimeEvent: (event: RuntimeSseEvent) => dispatch({ type: 'runtime-event', event }),
    reportError: (message: string) => dispatch({ type: 'operation-failed', message })
  }
}
