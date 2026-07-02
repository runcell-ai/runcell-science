import type {
  AgentArtifact,
  AgentSessionDetail,
  AgentSessionWorktreeDiffResponse,
  RuntimeSseEvent
} from '@open-science/contracts'
import { applyRuntimeEvent, byCreatedAt, upsertById } from './session-events'

export type WorktreeDiffAvailability = 'unknown' | 'checking' | 'available' | 'unavailable'
export type SidePanelKind = 'artifacts' | 'diff' | null

export interface WorkspaceState {
  activeSessionId: string | null
  detail: AgentSessionDetail | null
  diffAvailability: WorktreeDiffAvailability
  worktreeDiff: AgentSessionWorktreeDiffResponse | null
  isLoadingWorktreeDiff: boolean
  sidePanel: SidePanelKind
  activeArtifactId: string | null
  artifactDraft: string
  errorMessage: string | null
}

export const initialWorkspaceState: WorkspaceState = {
  activeSessionId: null,
  detail: null,
  diffAvailability: 'unknown',
  worktreeDiff: null,
  isLoadingWorktreeDiff: false,
  sidePanel: null,
  activeArtifactId: null,
  artifactDraft: '',
  errorMessage: null
}

/**
 * Async results carry the sessionId they were fetched for; the reducer drops
 * any that no longer match the active session, so switching sessions while
 * requests are in flight can never mix data from two sessions.
 */
export type WorkspaceAction =
  | { type: 'draft-started' }
  | { type: 'session-opened'; sessionId: string }
  | { type: 'session-loaded'; sessionId: string; detail: AgentSessionDetail }
  | { type: 'session-load-failed'; sessionId: string; message: string }
  | { type: 'draft-session-created'; sessionId: string; detail: AgentSessionDetail }
  | { type: 'detail-refetched'; sessionId: string; detail: AgentSessionDetail }
  | { type: 'diff-availability-resolved'; sessionId: string; available: boolean }
  | { type: 'runtime-event'; event: RuntimeSseEvent }
  | { type: 'diff-panel-opened' }
  | { type: 'diff-loaded'; sessionId: string; response: AgentSessionWorktreeDiffResponse }
  | { type: 'diff-load-failed'; sessionId: string; message: string }
  | { type: 'diff-panel-closed' }
  | { type: 'artifact-opened'; artifactId: string }
  | { type: 'artifacts-panel-opened' }
  | { type: 'artifacts-panel-closed' }
  | { type: 'artifact-selected'; artifactId: string | null }
  | { type: 'artifact-draft-changed'; value: string }
  | { type: 'artifact-created'; sessionId: string; artifact: AgentArtifact }
  | { type: 'operation-failed'; message: string }
  | { type: 'error-cleared' }

function newestArtifactId(detail: AgentSessionDetail | null): string | null {
  if (!detail || detail.artifacts.length === 0) {
    return null
  }
  return detail.artifacts[detail.artifacts.length - 1].id
}

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'draft-started':
      return initialWorkspaceState

    case 'session-opened':
      return {
        ...initialWorkspaceState,
        activeSessionId: action.sessionId,
        diffAvailability: 'checking'
      }

    case 'session-loaded': {
      if (action.sessionId !== state.activeSessionId) {
        return state
      }
      const artifactId = newestArtifactId(action.detail)
      return {
        ...state,
        detail: action.detail,
        activeArtifactId: artifactId,
        sidePanel: artifactId ? 'artifacts' : state.sidePanel
      }
    }

    case 'session-load-failed':
      if (action.sessionId !== state.activeSessionId) {
        return state
      }
      return {
        ...state,
        diffAvailability: 'unknown',
        errorMessage: action.message
      }

    case 'draft-session-created':
      return {
        ...initialWorkspaceState,
        activeSessionId: action.sessionId,
        detail: action.detail,
        diffAvailability: 'checking'
      }

    case 'detail-refetched':
      if (action.sessionId !== state.activeSessionId) {
        return state
      }
      return { ...state, detail: action.detail }

    case 'diff-availability-resolved':
      if (action.sessionId !== state.activeSessionId) {
        return state
      }
      return { ...state, diffAvailability: action.available ? 'available' : 'unavailable' }

    case 'runtime-event': {
      const event = action.event
      if (event.sessionId !== state.activeSessionId) {
        return state
      }
      const detail = applyRuntimeEvent(state.detail, event)
      if (event.type === 'artifact.created') {
        return {
          ...state,
          detail,
          activeArtifactId: event.artifact.id,
          sidePanel: 'artifacts'
        }
      }
      return detail === state.detail ? state : { ...state, detail }
    }

    case 'diff-panel-opened':
      return {
        ...state,
        sidePanel: 'diff',
        isLoadingWorktreeDiff: true,
        errorMessage: null
      }

    case 'diff-loaded': {
      if (action.sessionId !== state.activeSessionId) {
        return state
      }
      if (!action.response.isGitRepository) {
        return {
          ...state,
          diffAvailability: 'unavailable',
          worktreeDiff: null,
          isLoadingWorktreeDiff: false,
          sidePanel: state.sidePanel === 'diff' ? null : state.sidePanel
        }
      }
      return { ...state, worktreeDiff: action.response, isLoadingWorktreeDiff: false }
    }

    case 'diff-load-failed':
      if (action.sessionId !== state.activeSessionId) {
        return state
      }
      return { ...state, isLoadingWorktreeDiff: false, errorMessage: action.message }

    case 'diff-panel-closed':
      return state.sidePanel === 'diff' ? { ...state, sidePanel: null } : state

    case 'artifact-opened':
      return {
        ...state,
        activeArtifactId: action.artifactId,
        sidePanel: 'artifacts',
        artifactDraft: ''
      }

    case 'artifacts-panel-opened':
      return {
        ...state,
        activeArtifactId: state.activeArtifactId ?? newestArtifactId(state.detail),
        sidePanel: 'artifacts'
      }

    case 'artifacts-panel-closed':
      return {
        ...state,
        activeArtifactId: null,
        sidePanel: state.sidePanel === 'artifacts' ? null : state.sidePanel
      }

    case 'artifact-selected':
      return { ...state, activeArtifactId: action.artifactId }

    case 'artifact-draft-changed':
      return { ...state, artifactDraft: action.value }

    case 'artifact-created': {
      if (action.sessionId !== state.activeSessionId) {
        return state
      }
      return {
        ...state,
        detail: state.detail
          ? { ...state.detail, artifacts: byCreatedAt(upsertById(state.detail.artifacts, action.artifact)) }
          : state.detail,
        activeArtifactId: action.artifact.id,
        sidePanel: 'artifacts',
        artifactDraft: ''
      }
    }

    case 'operation-failed':
      return { ...state, errorMessage: action.message }

    case 'error-cleared':
      return state.errorMessage === null ? state : { ...state, errorMessage: null }
  }
}
