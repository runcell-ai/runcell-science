import assert from 'node:assert/strict'
import test from 'node:test'

import type { AgentEvent, AgentMessage, AgentSessionDetail, RuntimeSseEvent } from '@open-science/contracts'

import { applyRuntimeEvent, buildTimelineItems } from '../src/lib/session-events'

function detail(events: AgentEvent[] = []): AgentSessionDetail {
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
    events,
    diffs: [],
    artifacts: [],
    pendingRequests: []
  }
}

function notebookEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: 'event-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    provider: 'codex',
    eventType: 'notebook.execution',
    streamKind: 'notebook',
    title: 'Notebook execution',
    summary: 't.ipynb · cell-1 · ok',
    status: 'ok',
    detailJson: JSON.stringify({
      notebook: 't.ipynb',
      mode: 'exec-cell',
      cellId: 'cell-1',
      status: 'ok',
      executionCount: 3,
      durationMs: 10,
      outputs: [{ output_type: 'stream', name: 'stdout', text: 'hello\n' }],
      truncated: false
    }),
    createdAt: '2026-01-01T00:00:01.000Z',
    ...overrides
  }
}

test('applyRuntimeEvent folds notebook.execution events into session detail', () => {
  const event = notebookEvent()
  const next = applyRuntimeEvent(detail(), {
    id: event.id,
    type: 'notebook.execution',
    sessionId: 'session-1',
    turnId: 'turn-1',
    createdAt: event.createdAt,
    event
  } satisfies RuntimeSseEvent)

  assert.equal(next?.events.length, 1)
  assert.equal(next?.events[0]?.detailJson, event.detailJson)
})

function assistantMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: 'message-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    role: 'assistant',
    text: 'assistant text',
    status: 'completed',
    phase: null,
    providerItemId: 'item-1',
    createdAt: '2026-01-01T00:00:01.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
    ...overrides
  }
}

test('phased assistant messages stay distinct message timeline items', () => {
  const base = detail()
  const commentary = assistantMessage({ id: 'message-1', phase: 'commentary', providerItemId: 'item-1' })
  const finalAnswer = assistantMessage({
    id: 'message-2',
    phase: 'final_answer',
    providerItemId: 'item-2',
    createdAt: '2026-01-01T00:00:02.000Z',
    updatedAt: '2026-01-01T00:00:02.000Z'
  })

  const items = buildTimelineItems({ ...base, messages: [commentary, finalAnswer] }, null)

  assert.equal(items.length, 2)
  assert.deepEqual(
    items.map((item) => item.type),
    ['message', 'message']
  )
  if (items[0]?.type === 'message' && items[1]?.type === 'message') {
    assert.equal(items[0].message.phase, 'commentary')
    assert.equal(items[1].message.phase, 'final_answer')
  }
})

test('message.completed upserts a phased message by id without duplicating it', () => {
  const streaming = assistantMessage({ status: 'streaming', text: 'partial', phase: null })
  const base = { ...detail(), messages: [streaming] }

  const completed = assistantMessage({ status: 'completed', text: 'authoritative full text', phase: 'commentary' })
  const next = applyRuntimeEvent(base, {
    id: 'sse-1',
    type: 'message.completed',
    sessionId: 'session-1',
    turnId: 'turn-1',
    createdAt: completed.updatedAt,
    message: completed
  } satisfies RuntimeSseEvent)

  assert.equal(next?.messages.length, 1)
  assert.equal(next?.messages[0]?.status, 'completed')
  assert.equal(next?.messages[0]?.text, 'authoritative full text')
  assert.equal(next?.messages[0]?.phase, 'commentary')
})

test('buildTimelineItems maps parseable notebook execution detail and skips malformed detail', () => {
  const items = buildTimelineItems(
    detail([
      notebookEvent(),
      notebookEvent({ id: 'event-2', detailJson: '{bad json', createdAt: '2026-01-01T00:00:02.000Z' })
    ]),
    null
  )

  assert.equal(items.length, 1)
  assert.equal(items[0]?.type, 'notebook-execution')
  if (items[0]?.type === 'notebook-execution') {
    assert.equal(items[0].detail.outputs[0]?.output_type, 'stream')
  }
})
