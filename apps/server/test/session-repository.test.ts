import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

process.env.SQLITE_PATH = path.join(os.tmpdir(), `open-science-session-test-${process.pid}.sqlite`)
process.env.CHECKPOINT_GIT_DIR = path.join(os.tmpdir(), `open-science-checkpoints-${process.pid}.git`)
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
  rmSync(process.env.CHECKPOINT_GIT_DIR as string, { recursive: true, force: true })
})

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function createCheckpointTestRepo(): string {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'open-science-turn-checkpoint-'))
  git(cwd, ['init'])
  git(cwd, ['config', 'user.email', 'test@example.com'])
  git(cwd, ['config', 'user.name', 'Open Science Test'])
  mkdirSync(path.join(cwd, 'src'))
  writeFileSync(path.join(cwd, 'src', 'sample.txt'), 'before\n')
  git(cwd, ['add', '.'])
  git(cwd, ['commit', '-m', 'initial'])
  return cwd
}

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

test('turn diff events project to one latest diff per turn', () => {
  const repository = new AgentSessionRepository()
  const service = new AgentSessionService(repository)
  const response = service.createPendingSessionForInitialMessage({
    provider: 'codex',
    cwd: os.tmpdir(),
    initialMessage: 'change a file',
    model: null,
    runtimeMode: 'full_access'
  })
  const turn = response.detail.turns[0]
  assert.ok(turn)

  service.recordTurnDiff({
    sessionId: response.sessionId,
    turnId: turn.id,
    provider: 'codex',
    providerTurnId: 'provider-turn-1',
    providerItemId: 'file-change-1',
    files: [
      {
        path: 'src/example.ts',
        previousPath: null,
        kind: 'update',
        diff: '--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-old\n+new\n'
      }
    ]
  })

  service.recordTurnDiff({
    sessionId: response.sessionId,
    turnId: turn.id,
    provider: 'codex',
    source: 'checkpoint',
    providerTurnId: 'provider-turn-1',
    files: [
      {
        path: 'src/checkpoint.ts',
        previousPath: null,
        kind: 'update',
        diff: '--- a/src/checkpoint.ts\n+++ b/src/checkpoint.ts\n@@ -1 +1 @@\n-before\n+after\n'
      }
    ],
    unifiedDiff: 'diff --git a/src/checkpoint.ts b/src/checkpoint.ts\n'
  })

  service.recordTurnDiff({
    sessionId: response.sessionId,
    turnId: turn.id,
    provider: 'codex',
    providerTurnId: 'provider-turn-1',
    providerItemId: 'late-provider-item',
    files: [
      {
        path: 'src/late-provider.ts',
        previousPath: null,
        kind: 'update',
        diff: '--- a/src/late-provider.ts\n+++ b/src/late-provider.ts\n@@ -1 +1 @@\n-a\n+b\n'
      }
    ]
  })

  const projected = repository.findSessionDetail(response.sessionId)
  assert.equal(projected?.diffs?.length, 1)
  assert.equal(projected?.diffs?.[0]?.turnId, turn.id)
  assert.equal(projected?.diffs?.[0]?.source, 'checkpoint')
  assert.equal(projected?.diffs?.[0]?.providerItemId, null)
  assert.equal(projected?.diffs?.[0]?.files[0]?.path, 'src/checkpoint.ts')
  assert.equal(projected?.diffs?.[0]?.unifiedDiff, 'diff --git a/src/checkpoint.ts b/src/checkpoint.ts\n')
})

test('provider file patch updates merge files within a turn', () => {
  const repository = new AgentSessionRepository()
  const service = new AgentSessionService(repository)
  const response = service.createPendingSessionForInitialMessage({
    provider: 'codex',
    cwd: os.tmpdir(),
    initialMessage: 'change multiple files',
    model: null,
    runtimeMode: 'full_access'
  })
  const turn = response.detail.turns[0]
  assert.ok(turn)

  service.recordTurnDiff({
    sessionId: response.sessionId,
    turnId: turn.id,
    provider: 'codex',
    providerTurnId: 'provider-turn-1',
    providerItemId: 'file-change-1',
    files: [
      {
        path: 'src/first.ts',
        previousPath: null,
        kind: 'update',
        diff: '--- a/src/first.ts\n+++ b/src/first.ts\n@@ -1 +1 @@\n-a\n+b\n'
      }
    ]
  })

  service.recordTurnDiff({
    sessionId: response.sessionId,
    turnId: turn.id,
    provider: 'codex',
    providerTurnId: 'provider-turn-1',
    providerItemId: 'file-change-2',
    files: [
      {
        path: 'src/second.ts',
        previousPath: null,
        kind: 'add',
        diff: '--- /dev/null\n+++ b/src/second.ts\n@@ -0,0 +1 @@\n+new\n'
      }
    ]
  })

  const projected = repository.findSessionDetail(response.sessionId)
  assert.deepEqual(
    projected?.diffs?.[0]?.files.map((file) => file.path),
    ['src/first.ts', 'src/second.ts']
  )
})

test('provider file patch updates replace files for the same provider item', () => {
  const repository = new AgentSessionRepository()
  const service = new AgentSessionService(repository)
  const response = service.createPendingSessionForInitialMessage({
    provider: 'codex',
    cwd: os.tmpdir(),
    initialMessage: 'rewrite a file change item',
    model: null,
    runtimeMode: 'full_access'
  })
  const turn = response.detail.turns[0]
  assert.ok(turn)

  service.recordTurnDiff({
    sessionId: response.sessionId,
    turnId: turn.id,
    provider: 'codex',
    providerTurnId: 'provider-turn-1',
    providerItemId: 'file-change-1',
    files: [
      {
        path: 'src/first.ts',
        previousPath: null,
        kind: 'update',
        diff: '--- a/src/first.ts\n+++ b/src/first.ts\n@@ -1 +1 @@\n-a\n+b\n'
      },
      {
        path: 'src/second.ts',
        previousPath: null,
        kind: 'update',
        diff: '--- a/src/second.ts\n+++ b/src/second.ts\n@@ -1 +1 @@\n-a\n+b\n'
      }
    ]
  })

  service.recordTurnDiff({
    sessionId: response.sessionId,
    turnId: turn.id,
    provider: 'codex',
    providerTurnId: 'provider-turn-1',
    providerItemId: 'file-change-1',
    files: [
      {
        path: 'src/first.ts',
        previousPath: null,
        kind: 'update',
        diff: '--- a/src/first.ts\n+++ b/src/first.ts\n@@ -1 +1 @@\n-b\n+c\n'
      }
    ]
  })

  let projected = repository.findSessionDetail(response.sessionId)
  assert.deepEqual(
    projected?.diffs?.[0]?.files.map((file) => file.path),
    ['src/first.ts']
  )
  assert.equal(projected?.diffs?.[0]?.files[0]?.diff.includes('+c'), true)

  service.recordTurnDiff({
    sessionId: response.sessionId,
    turnId: turn.id,
    provider: 'codex',
    providerTurnId: 'provider-turn-1',
    providerItemId: 'file-change-1',
    files: []
  })

  projected = repository.findSessionDetail(response.sessionId)
  assert.deepEqual(projected?.diffs?.[0]?.files, [])
})

test('turn completion records checkpoint diff when provider emits no diff', () => {
  const cwd = createCheckpointTestRepo()
  try {
    const repository = new AgentSessionRepository()
    const service = new AgentSessionService(repository)
    const response = service.createPendingSessionForInitialMessage({
      provider: 'claude',
      cwd,
      initialMessage: 'change files without provider diff',
      model: null,
      runtimeMode: 'full_access'
    })
    const turn = response.detail.turns[0]
    assert.ok(turn)

    service.captureTurnCheckpointBaseline({
      session: response.detail.session,
      turn
    })

    writeFileSync(path.join(cwd, 'src', 'sample.txt'), 'after\n')
    writeFileSync(path.join(cwd, 'src', 'new.txt'), 'new file\n')

    service.appendAssistantMessageDelta({
      sessionId: response.sessionId,
      turnId: turn.id,
      provider: 'claude',
      delta: 'changed files',
      providerItemId: 'assistant-item'
    })
    service.completeTurn(response.sessionId, turn.id)

    const projected = repository.findSessionDetail(response.sessionId)
    const diff = projected?.diffs?.[0]
    assert.equal(diff?.source, 'checkpoint')
    assert.equal(diff?.files.length, 0)
    assert.ok(diff?.unifiedDiff?.includes('diff --git a/src/sample.txt b/src/sample.txt'))
    assert.ok(diff?.unifiedDiff?.includes('-before'))
    assert.ok(diff?.unifiedDiff?.includes('+after'))
    assert.ok(diff?.unifiedDiff?.includes('diff --git a/src/new.txt b/src/new.txt'))

    const checkpoint = repository.findTurnCheckpoint(response.sessionId, turn.id)
    assert.equal(checkpoint?.status, 'ready')
    assert.ok(checkpoint?.baselineCommit)
    assert.ok(checkpoint?.completedCommit)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('provider diff remains the projected turn diff when checkpoint data also exists', () => {
  const cwd = createCheckpointTestRepo()
  try {
    const repository = new AgentSessionRepository()
    const service = new AgentSessionService(repository)
    const response = service.createPendingSessionForInitialMessage({
      provider: 'codex',
      cwd,
      initialMessage: 'change files with provider diff',
      model: null,
      runtimeMode: 'full_access'
    })
    const turn = response.detail.turns[0]
    assert.ok(turn)

    service.captureTurnCheckpointBaseline({
      session: response.detail.session,
      turn
    })

    writeFileSync(path.join(cwd, 'src', 'sample.txt'), 'after\n')

    service.recordTurnDiff({
      sessionId: response.sessionId,
      turnId: turn.id,
      provider: 'codex',
      providerTurnId: 'provider-turn-1',
      providerItemId: 'file-change-1',
      files: [
        {
          path: 'src/sample.txt',
          previousPath: null,
          kind: 'update',
          diff: '--- a/src/sample.txt\n+++ b/src/sample.txt\n@@ -1 +1 @@\n-before\n+provider after\n'
        }
      ]
    })

    service.appendAssistantMessageDelta({
      sessionId: response.sessionId,
      turnId: turn.id,
      provider: 'codex',
      delta: 'changed files',
      providerItemId: 'assistant-item'
    })
    service.completeTurn(response.sessionId, turn.id)

    const projected = repository.findSessionDetail(response.sessionId)
    const diff = projected?.diffs?.[0]
    assert.equal(diff?.source, 'provider')
    assert.equal(diff?.files[0]?.diff.includes('provider after'), true)
    assert.equal(diff?.unifiedDiff, null)

    const checkpoint = repository.findTurnCheckpoint(response.sessionId, turn.id)
    assert.equal(checkpoint?.status, 'ready')
    assert.ok(checkpoint?.completedCommit)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('follow-up turns require an activated session and reject concurrent running turns', () => {
  const repository = new AgentSessionRepository()
  const service = new AgentSessionService(repository)
  const response = service.createPendingSessionForInitialMessage({
    provider: 'codex',
    cwd: os.tmpdir(),
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
