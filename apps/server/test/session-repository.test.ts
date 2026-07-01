import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

process.env.SQLITE_PATH = path.join(os.tmpdir(), `open-science-session-test-${process.pid}.sqlite`)
process.env.LOG_LEVEL = 'silent'

const [{ runMigrations }, { closeDb, getDb }, { AgentSessionRepository }, { AgentSessionService, AgentSessionServiceError }] =
  await Promise.all([
    import('../src/db/migrate'),
    import('../src/db/connection'),
    import('../src/services/agent-session-repository'),
    import('../src/services/agent-session-service')
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

test('pending sessions stay hidden until a non-empty assistant delta activates them', () => {
  const repository = new AgentSessionRepository()
  const detail = repository.createPendingSessionFromInitialMessage({
    provider: 'codex',
    cwd: process.cwd(),
    initialMessage: 'hello',
    model: null,
    runtimeMode: 'full_access'
  })
  const turn = detail.turns[0]
  assert.ok(turn)
  assert.equal(detail.session.status, 'pending_activation')
  assert.equal(repository.listActivatedSessions().length, 0)

  repository.appendAssistantMessageDelta({
    sessionId: detail.session.id,
    turnId: turn.id,
    provider: 'codex',
    delta: 'assistant reply',
    providerItemId: 'assistant-item'
  })

  const visible = repository.listActivatedSessions()
  assert.equal(visible.length, 1)
  assert.equal(visible[0]?.id, detail.session.id)

  const activated = repository.findSessionDetail(detail.session.id)
  assert.equal(activated?.session.status, 'running')
  assert.ok(activated?.session.activatedAt)
})

test('assistant deltas with the same provider item id merge into one projected message', () => {
  const repository = new AgentSessionRepository()
  const detail = repository.createPendingSessionFromInitialMessage({
    provider: 'claude',
    cwd: process.cwd(),
    initialMessage: 'hello',
    model: null,
    runtimeMode: 'full_access'
  })
  const turn = detail.turns[0]
  assert.ok(turn)

  repository.appendAssistantMessageDelta({
    sessionId: detail.session.id,
    turnId: turn.id,
    provider: 'claude',
    delta: 'hello',
    providerItemId: 'claude:turn:assistant'
  })
  repository.appendAssistantMessageDelta({
    sessionId: detail.session.id,
    turnId: turn.id,
    provider: 'claude',
    delta: ' world',
    providerItemId: 'claude:turn:assistant'
  })
  repository.completeTurn(detail.session.id, turn.id)

  const projected = repository.findSessionDetail(detail.session.id)
  const assistantMessages = projected?.messages.filter((message) => message.role === 'assistant') ?? []
  assert.equal(assistantMessages.length, 1)
  assert.equal(assistantMessages[0]?.text, 'hello world')
  assert.equal(assistantMessages[0]?.status, 'completed')
  assert.equal(projected?.session.status, 'ready')
})

test('follow-up turns require an activated session and reject concurrent running turns', () => {
  const repository = new AgentSessionRepository()
  const service = new AgentSessionService(repository)
  const response = service.createPendingSessionForInitialMessage({
    provider: 'codex',
    cwd: process.cwd(),
    initialMessage: 'hello',
    model: null,
    runtimeMode: 'full_access'
  })
  const turn = response.detail.turns[0]
  assert.ok(turn)

  assert.throws(
    () => service.startFollowupTurn({ sessionId: response.sessionId, message: 'blocked' }),
    (error) => error instanceof AgentSessionServiceError && error.code === 'conflict'
  )

  service.appendAssistantMessageDelta({
    sessionId: response.sessionId,
    turnId: turn.id,
    provider: 'codex',
    delta: 'assistant reply',
    providerItemId: 'assistant-item'
  })
  service.completeTurn(response.sessionId, turn.id)

  const followup = service.startFollowupTurn({
    sessionId: response.sessionId,
    message: 'next'
  })
  assert.equal(followup.status, 'running')

  assert.throws(
    () => service.startFollowupTurn({ sessionId: response.sessionId, message: 'second running turn' }),
    (error) => error instanceof AgentSessionServiceError && error.code === 'conflict'
  )
})
