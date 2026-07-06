import assert from 'node:assert/strict'
import test from 'node:test'

import type { AgentArtifact, AgentSessionDetail, RuntimeSseEvent } from '@open-science/contracts'

import { initialWorkspaceState, workspaceReducer, type WorkspaceState } from '../src/lib/workspace-state'

function artifact(overrides: Partial<AgentArtifact> = {}): AgentArtifact {
  return {
    id: 'artifact-1',
    sessionId: 'session-1',
    turnId: null,
    messageId: null,
    kind: 'markdown',
    source: 'file',
    path: 'reports/summary.md',
    url: null,
    title: 'Summary',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  } as AgentArtifact
}

function detail(artifacts: AgentArtifact[] = []): AgentSessionDetail {
  return {
    session: {
      id: 'session-1',
      provider: 'codex',
      title: 'Session',
      cwd: '/tmp/workspace',
      model: null,
      runtimeMode: 'full_access',
      permissionMode: null,
      status: 'running',
      activatedAt: '2026-01-01T00:00:00.000Z',
      providerSessionId: null,
      providerThreadId: null,
      resumeCursorJson: null,
      lastError: null,
      disabledMcpServers: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    },
    turns: [],
    messages: [],
    events: [],
    diffs: [],
    artifacts,
    pendingRequests: []
  }
}

function baseState(): WorkspaceState {
  return {
    ...initialWorkspaceState,
    activeSessionId: 'session-1',
    detail: detail([artifact()])
  }
}

function artifactEvent(
  type: 'artifact.created' | 'artifact.updated',
  target: AgentArtifact,
  focus?: boolean
): RuntimeSseEvent {
  return {
    id: 'sse-1',
    type,
    sessionId: 'session-1',
    turnId: null,
    createdAt: target.updatedAt,
    artifact: target,
    ...(focus !== undefined ? { focus } : {})
  }
}

test('artifact.created opens the artifacts panel on the new artifact', () => {
  const created = artifact({ id: 'artifact-2', path: 'reports/new.md' })
  const next = workspaceReducer(baseState(), { type: 'runtime-event', event: artifactEvent('artifact.created', created) })
  assert.equal(next.activeArtifactId, 'artifact-2')
  assert.equal(next.sidePanel, 'artifacts')
})

test('artifact.updated without focus keeps the current panel and selection', () => {
  const updated = artifact({ updatedAt: '2026-01-01T00:05:00.000Z' })
  const next = workspaceReducer(baseState(), { type: 'runtime-event', event: artifactEvent('artifact.updated', updated) })
  assert.equal(next.activeArtifactId, null)
  assert.equal(next.sidePanel, null)
  // The updated artifact still folds into the detail projection.
  assert.equal(next.detail?.artifacts[0]?.updatedAt, '2026-01-01T00:05:00.000Z')
})

test('artifact.updated with focus re-opens the artifact', () => {
  const updated = artifact({ updatedAt: '2026-01-01T00:05:00.000Z' })
  const next = workspaceReducer(baseState(), {
    type: 'runtime-event',
    event: artifactEvent('artifact.updated', updated, true)
  })
  assert.equal(next.activeArtifactId, 'artifact-1')
  assert.equal(next.sidePanel, 'artifacts')
})

test('artifact events for other sessions are ignored', () => {
  const foreign = artifact({ id: 'artifact-9', sessionId: 'session-2' })
  const state = baseState()
  const next = workspaceReducer(state, {
    type: 'runtime-event',
    event: { ...artifactEvent('artifact.created', foreign), sessionId: 'session-2' }
  })
  assert.equal(next, state)
})
