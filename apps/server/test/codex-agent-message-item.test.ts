import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import type { AgentSessionDetail, RuntimeSseEvent } from '@runcell-science/contracts'

process.env.SQLITE_PATH = path.join(os.tmpdir(), `open-science-message-item-test-${process.pid}.sqlite`)
process.env.CHECKPOINT_GIT_DIR = path.join(os.tmpdir(), `open-science-message-item-checkpoints-${process.pid}.git`)
process.env.LOG_LEVEL = 'silent'

const [{ runMigrations }, { closeDb, getDb }, { AgentSessionRepository }, { AgentSessionService }, { sessionEventBus }] =
  await Promise.all([
    import('../src/db/migrate'),
    import('../src/db/connection'),
    import('../src/services/agent-session-repository'),
    import('../src/services/agent-session-service'),
    import('../src/runtime/session-event-bus')
  ])

test.before(async () => {
  await runMigrations()
})

test.beforeEach(() => {
  getDb().prepare('DELETE FROM agent_sessions').run()
})

test.after(() => {
  closeDb()
})

function createCodexSession(repository: InstanceType<typeof AgentSessionRepository>): {
  detail: AgentSessionDetail
  sessionId: string
  turnId: string
} {
  const detail = repository.createPendingSessionFromInitialMessage({
    provider: 'codex',
    cwd: process.cwd(),
    initialMessage: 'hello',
    model: null,
    runtimeMode: 'full_access'
  })
  const turn = detail.turns[0]
  assert.ok(turn)
  return { detail, sessionId: detail.session.id, turnId: turn.id }
}

test('completed commentary item replaces streamed text and sets no final response', () => {
  const repository = new AgentSessionRepository()
  const { sessionId, turnId } = createCodexSession(repository)

  repository.appendAssistantMessageDelta({
    sessionId,
    turnId,
    provider: 'codex',
    delta: 'partial comm',
    providerItemId: 'item-a'
  })
  repository.appendAssistantMessageDelta({
    sessionId,
    turnId,
    provider: 'codex',
    delta: 'entary…',
    providerItemId: 'item-a'
  })

  const projection = repository.completeAssistantMessageItem({
    sessionId,
    turnId,
    provider: 'codex',
    providerItemId: 'item-a',
    text: 'Authoritative commentary text.',
    phase: 'commentary'
  })

  assert.equal(projection.message.providerItemId, 'item-a')
  assert.equal(projection.message.text, 'Authoritative commentary text.')
  assert.equal(projection.message.phase, 'commentary')
  assert.equal(projection.message.status, 'completed')

  const assistantMessages = projection.detail.messages.filter((message) => message.role === 'assistant')
  assert.equal(assistantMessages.length, 1)

  const turn = projection.detail.turns.find((entry) => entry.id === turnId)
  assert.equal(turn?.finalResponse, null)
  assert.equal(turn?.finalMessageId, null)
})

test('completed final_answer item sets the turn final response', () => {
  const repository = new AgentSessionRepository()
  const { sessionId, turnId } = createCodexSession(repository)

  repository.completeAssistantMessageItem({
    sessionId,
    turnId,
    provider: 'codex',
    providerItemId: 'item-commentary',
    text: 'Working on it…',
    phase: 'commentary'
  })
  const projection = repository.completeAssistantMessageItem({
    sessionId,
    turnId,
    provider: 'codex',
    providerItemId: 'item-final',
    text: 'Here is the answer.',
    phase: 'final_answer'
  })

  const turn = projection.detail.turns.find((entry) => entry.id === turnId)
  assert.equal(turn?.finalResponse, 'Here is the answer.')
  assert.equal(turn?.finalMessageId, projection.message.id)
})

test('commentary-only turn keeps final response null through fallback completion', () => {
  const repository = new AgentSessionRepository()
  const { sessionId, turnId } = createCodexSession(repository)

  repository.completeAssistantMessageItem({
    sessionId,
    turnId,
    provider: 'codex',
    providerItemId: 'item-a',
    text: 'Only commentary here.',
    phase: 'commentary'
  })

  const projection = repository.completeTurn(sessionId, turnId, { finalResponseFallback: true })
  const turn = projection?.detail.turns.find((entry) => entry.id === turnId)
  assert.equal(turn?.finalResponse, null)
  assert.equal(turn?.finalMessageId, null)
})

test('fallback promotes the last phase-less assistant message', () => {
  const repository = new AgentSessionRepository()
  const { sessionId, turnId } = createCodexSession(repository)

  repository.completeAssistantMessageItem({
    sessionId,
    turnId,
    provider: 'codex',
    providerItemId: 'item-1',
    text: 'First legacy message.',
    phase: null
  })
  const second = repository.completeAssistantMessageItem({
    sessionId,
    turnId,
    provider: 'codex',
    providerItemId: 'item-2',
    text: 'Second legacy message.',
    phase: null
  })

  const projection = repository.completeTurn(sessionId, turnId, { finalResponseFallback: true })
  const turn = projection?.detail.turns.find((entry) => entry.id === turnId)
  assert.equal(turn?.finalResponse, 'Second legacy message.')
  assert.equal(turn?.finalMessageId, second.message.id)
})

test('fallback skips blank-text assistant messages', () => {
  const repository = new AgentSessionRepository()
  const { sessionId, turnId } = createCodexSession(repository)

  repository.completeAssistantMessageItem({
    sessionId,
    turnId,
    provider: 'codex',
    providerItemId: 'item-1',
    text: 'Real content.',
    phase: null
  })
  repository.completeAssistantMessageItem({
    sessionId,
    turnId,
    provider: 'codex',
    providerItemId: 'item-2',
    text: '   \n',
    phase: null
  })

  const projection = repository.completeTurn(sessionId, turnId, { finalResponseFallback: true })
  const turn = projection?.detail.turns.find((entry) => entry.id === turnId)
  assert.equal(turn?.finalResponse, 'Real content.')
})

test('completed item with no prior deltas inserts a completed message', () => {
  const repository = new AgentSessionRepository()
  const { sessionId, turnId } = createCodexSession(repository)

  const projection = repository.completeAssistantMessageItem({
    sessionId,
    turnId,
    provider: 'codex',
    providerItemId: 'item-short',
    text: 'Done.',
    phase: 'final_answer'
  })

  assert.equal(projection.message.text, 'Done.')
  assert.equal(projection.message.status, 'completed')
  assert.equal(projection.message.phase, 'final_answer')
  const turn = projection.detail.turns.find((entry) => entry.id === turnId)
  assert.equal(turn?.finalResponse, 'Done.')
})

test('completed item with no prior deltas activates a pending session', () => {
  const repository = new AgentSessionRepository()
  const { sessionId, turnId } = createCodexSession(repository)

  assert.equal(repository.listActivatedSessions().length, 0)

  const projection = repository.completeAssistantMessageItem({
    sessionId,
    turnId,
    provider: 'codex',
    providerItemId: 'item-short',
    text: 'Done.',
    phase: 'final_answer'
  })

  assert.ok(projection.detail.session.activatedAt)
  assert.equal(projection.detail.session.status, 'running')
  assert.equal(repository.listActivatedSessions().length, 1)

  repository.completeTurn(sessionId, turnId)
  assert.equal(repository.listActivatedSessions().length, 1)
})

test('fallback never overwrites an explicit final answer', () => {
  const repository = new AgentSessionRepository()
  const { sessionId, turnId } = createCodexSession(repository)

  const final = repository.completeAssistantMessageItem({
    sessionId,
    turnId,
    provider: 'codex',
    providerItemId: 'item-final',
    text: 'Explicit final answer.',
    phase: 'final_answer'
  })
  repository.completeAssistantMessageItem({
    sessionId,
    turnId,
    provider: 'codex',
    providerItemId: 'item-late-legacy',
    text: 'Later legacy message.',
    phase: null
  })

  const projection = repository.completeTurn(sessionId, turnId, { finalResponseFallback: true })
  const turn = projection?.detail.turns.find((entry) => entry.id === turnId)
  assert.equal(turn?.finalResponse, 'Explicit final answer.')
  assert.equal(turn?.finalMessageId, final.message.id)
})

test('completeTurn without fallback leaves final response untouched', () => {
  const repository = new AgentSessionRepository()
  const { sessionId, turnId } = createCodexSession(repository)

  repository.completeAssistantMessageItem({
    sessionId,
    turnId,
    provider: 'codex',
    providerItemId: 'item-1',
    text: 'Legacy message.',
    phase: null
  })

  const projection = repository.completeTurn(sessionId, turnId)
  const turn = projection?.detail.turns.find((entry) => entry.id === turnId)
  assert.equal(turn?.finalResponse, null)
})

test('service publishes message.completed for every assistant message in the turn', () => {
  const repository = new AgentSessionRepository()
  const service = new AgentSessionService(repository)
  const { sessionId, turnId } = createCodexSession(repository)

  const events: RuntimeSseEvent[] = []
  const unsubscribe = sessionEventBus.subscribe(sessionId, (event) => {
    events.push(event)
  })

  try {
    // Two streamed messages; the first is finalized by its completed item,
    // the second stays streaming until turn completion (safety net).
    repository.appendAssistantMessageDelta({
      sessionId,
      turnId,
      provider: 'codex',
      delta: 'first message',
      providerItemId: 'item-1'
    })
    repository.appendAssistantMessageDelta({
      sessionId,
      turnId,
      provider: 'codex',
      delta: 'second message',
      providerItemId: 'item-2'
    })

    const first = service.completeAssistantMessageItem({
      sessionId,
      turnId,
      provider: 'codex',
      providerItemId: 'item-1',
      text: 'first message (authoritative)',
      phase: 'commentary'
    })

    service.completeTurn(sessionId, turnId, { finalResponseFallback: true })

    const completedEvents = events.filter(
      (event): event is Extract<RuntimeSseEvent, { type: 'message.completed' }> =>
        event.type === 'message.completed'
    )
    const completedIds = new Set(completedEvents.map((event) => event.message.id))

    assert.ok(completedIds.has(first.id), 'item-completed message must publish message.completed')
    assert.equal(
      completedEvents.length >= 2,
      true,
      'both assistant messages must publish message.completed'
    )

    const detail = repository.findSessionDetail(sessionId)
    const assistantMessages = detail?.messages.filter((message) => message.role === 'assistant') ?? []
    assert.equal(assistantMessages.length, 2)
    for (const message of assistantMessages) {
      assert.equal(message.status, 'completed')
      assert.ok(completedIds.has(message.id), `message ${message.id} must have a completed event`)
    }
  } finally {
    unsubscribe()
  }
})

test('findSessionDetail projects phase and hides the audit event from activity', () => {
  const repository = new AgentSessionRepository()
  const { sessionId, turnId } = createCodexSession(repository)

  repository.completeAssistantMessageItem({
    sessionId,
    turnId,
    provider: 'codex',
    providerItemId: 'item-1',
    text: 'Commentary.',
    phase: 'commentary'
  })
  repository.completeAssistantMessageItem({
    sessionId,
    turnId,
    provider: 'codex',
    providerItemId: 'item-2',
    text: 'Final.',
    phase: 'final_answer'
  })

  const detail = repository.findSessionDetail(sessionId)
  assert.ok(detail)

  const assistantMessages = detail.messages.filter((message) => message.role === 'assistant')
  assert.deepEqual(
    assistantMessages.map((message) => message.phase),
    ['commentary', 'final_answer']
  )

  assert.equal(
    detail.events.some((event) => event.eventType === 'message.item.completed'),
    false,
    'audit rows must not surface as activity'
  )

  const auditRows = getDb()
    .prepare(
      `SELECT COUNT(*) AS count FROM agent_events WHERE session_id = ? AND event_type = 'message.item.completed'`
    )
    .get(sessionId) as { count: number }
  assert.equal(auditRows.count, 2, 'audit rows must still be persisted')
})
