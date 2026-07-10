import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import type { AgentSessionDetail } from '@runcell-science/contracts'

// Env must be pinned before importing anything that reads config/env.ts.
const fakeAgentPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-grok-agent.mjs')
chmodSync(fakeAgentPath, 0o755)
process.env.SQLITE_PATH = path.join(os.tmpdir(), `open-science-grok-runtime-test-${process.pid}.sqlite`)
process.env.CHECKPOINT_GIT_DIR = path.join(os.tmpdir(), `open-science-grok-checkpoints-${process.pid}.git`)
process.env.LOG_LEVEL = 'silent'
process.env.GROK_BINARY_PATH = fakeAgentPath
process.env.GROK_DEFAULT_MODEL = ''

const [{ runMigrations }, { closeDb, getDb }, { agentSessionService }, { GrokRuntime }] = await Promise.all([
  import('../src/db/migrate'),
  import('../src/db/connection'),
  import('../src/services'),
  import('../src/runtime/providers/grok/grok-runtime')
])

const cwd = mkdtempSync(path.join(os.tmpdir(), 'grok-runtime-test-cwd-'))
const logDir = mkdtempSync(path.join(os.tmpdir(), 'grok-runtime-test-logs-'))
let logCounter = 0

test.before(async () => {
  await runMigrations()
})

test.beforeEach(() => {
  getDb().prepare('DELETE FROM agent_sessions').run()
})

test.after(() => {
  closeDb()
  rmSync(process.env.SQLITE_PATH as string, { force: true })
  rmSync(cwd, { recursive: true, force: true })
  rmSync(logDir, { recursive: true, force: true })
})

function useScenario(scenario: string, extraEnv: Record<string, string | undefined> = {}): string {
  logCounter += 1
  const logPath = path.join(logDir, `wire-${logCounter}.jsonl`)
  process.env.FAKE_GROK_SCENARIO = scenario
  process.env.FAKE_GROK_LOG = logPath
  delete process.env.FAKE_GROK_PERMISSION_OPTIONS
  for (const [key, value] of Object.entries(extraEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  return logPath
}

function readWireLog(logPath: string): Record<string, unknown>[] {
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

function createSession(initialMessage: string, model?: string) {
  const created = agentSessionService.createPendingSessionForInitialMessage({
    provider: 'grok',
    cwd,
    initialMessage,
    ...(model ? { model } : {})
  })
  const turn = created.detail.turns[0]
  const message = created.detail.messages[0]
  assert.ok(turn && message)
  return { session: created.detail.session, turn, message }
}

function runtimeStates(runtime: InstanceType<typeof GrokRuntime>): Map<string, unknown> {
  return (runtime as unknown as { sessions: Map<string, unknown> }).sessions
}

function detailOf(sessionId: string): AgentSessionDetail {
  const detail = agentSessionService.getSessionDetail(sessionId)
  assert.ok(detail, 'expected session detail')
  return detail
}

async function waitFor<T>(probe: () => T | null | undefined, what: string, timeoutMs = 8000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = probe()
    if (value !== null && value !== undefined) {
      return value
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

function waitForTurnStatus(sessionId: string, turnId: string, status: string): Promise<AgentSessionDetail> {
  return waitFor(() => {
    const detail = detailOf(sessionId)
    return detail.turns.find((turn) => turn.id === turnId)?.status === status ? detail : null
  }, `turn ${status}`)
}

test('initial grok turn streams deltas, binds the provider session, and completes', async () => {
  useScenario('echo')
  const runtime = new GrokRuntime()
  try {
    const { session, turn, message } = createSession('hello grok')
    await runtime.startInitialTurn({ session, turn, message })

    const detail = await waitForTurnStatus(session.id, turn.id, 'completed')
    assert.equal(detail.session.providerSessionId, 'fake-acp-session')
    assert.equal(detail.session.status, 'ready')

    const assistant = detail.messages.find((entry) => entry.role === 'assistant')
    assert.ok(assistant?.text.startsWith('ACK:'), 'assistant text should come from streamed deltas')
    // Guidance rides in the first prompt as its own block, before the user text.
    assert.ok(assistant.text.endsWith('|hello grok'))
    assert.ok(assistant.text.includes('Jupyter notebooks'))
  } finally {
    await runtime.dispose()
  }
})

test('turn settles through the private prompt_complete fallback when the RPC never answers', async () => {
  useScenario('prompt-complete-fallback')
  const runtime = new GrokRuntime()
  try {
    const { session, turn, message } = createSession('use the fallback')
    await runtime.startInitialTurn({ session, turn, message })

    const detail = await waitForTurnStatus(session.id, turn.id, 'completed')
    const assistant = detail.messages.find((entry) => entry.role === 'assistant')
    assert.equal(assistant?.text, 'FALLBACK-TEXT')
  } finally {
    await runtime.dispose()
  }
})

test('duplicate completion (RPC response plus stale notification) settles the turn exactly once', async () => {
  useScenario('duplicate-completion')
  const runtime = new GrokRuntime()
  try {
    const { session, turn, message } = createSession('double settle')
    await runtime.startInitialTurn({ session, turn, message })

    const detail = await waitForTurnStatus(session.id, turn.id, 'completed')
    // Give the stale notification a beat to arrive, then re-check nothing regressed.
    await new Promise((resolve) => setTimeout(resolve, 150))
    const after = detailOf(session.id)
    assert.equal(after.turns.filter((entry) => entry.status === 'completed').length, 1)
    assert.equal(after.session.status, 'ready')
    assert.equal(detail.turns[0]?.status, 'completed')
  } finally {
    await runtime.dispose()
  }
})

test('permission requests bridge to pending requests and an allow selects an allow option', async () => {
  const logPath = useScenario('permission')
  const runtime = new GrokRuntime()
  try {
    const { session, turn, message } = createSession('run a tool')
    await runtime.startInitialTurn({ session, turn, message })

    const request = await waitFor(
      () => detailOf(session.id).pendingRequests.find((entry) => entry.status === 'open'),
      'pending permission request'
    )
    assert.equal(request.type, 'session/request_permission')

    await runtime.resolveRequest({ session, request, resolution: { decision: 'allow' } })
    await waitForTurnStatus(session.id, turn.id, 'completed')

    const wire = readWireLog(logPath)
    const response = wire.find((entry) => entry.permissionResponse !== undefined)
    assert.deepEqual(response?.permissionResponse, { outcome: { outcome: 'selected', optionId: 'opt-allow' } })
  } finally {
    await runtime.dispose()
  }
})

test('deny with only allow options reaches the agent as cancelled, never as an approval', async () => {
  const logPath = useScenario('permission', {
    FAKE_GROK_PERMISSION_OPTIONS: '[{"optionId":"only-allow","kind":"allow_once"}]'
  })
  const runtime = new GrokRuntime()
  try {
    const { session, turn, message } = createSession('try a tool')
    await runtime.startInitialTurn({ session, turn, message })

    const request = await waitFor(
      () => detailOf(session.id).pendingRequests.find((entry) => entry.status === 'open'),
      'pending permission request'
    )
    await runtime.resolveRequest({ session, request, resolution: { decision: 'deny' } })
    await waitForTurnStatus(session.id, turn.id, 'completed')

    const wire = readWireLog(logPath)
    const response = wire.find((entry) => entry.permissionResponse !== undefined)
    assert.deepEqual(response?.permissionResponse, { outcome: { outcome: 'cancelled' } })
  } finally {
    await runtime.dispose()
  }
})

test('failed session setup cleans up runtime state instead of leaking the agent process', async () => {
  useScenario('session-new-fail')
  const runtime = new GrokRuntime()
  try {
    const { session, turn, message } = createSession('never starts')
    await assert.rejects(runtime.startInitialTurn({ session, turn, message }), /session\/new failed/)
    assert.equal(runtimeStates(runtime).size, 0)
  } finally {
    await runtime.dispose()
  }
})

test('failed model selection on the initial turn cleans up runtime state (outer catch path)', async () => {
  useScenario('set-model-fail')
  const runtime = new GrokRuntime()
  try {
    const { session, turn, message } = createSession('never starts', 'grok-9-imaginary')
    await assert.rejects(
      runtime.startInitialTurn({ session, turn, message }),
      /Failed to select Grok model 'grok-9-imaginary'/
    )
    assert.equal(runtimeStates(runtime).size, 0)
  } finally {
    await runtime.dispose()
  }
})

test('an async prompt error on an unactivated session discards it and drops the runtime state', async () => {
  useScenario('prompt-fail')
  const runtime = new GrokRuntime()
  try {
    const { session, turn, message } = createSession('prompt will be rejected')
    // startInitialTurn succeeds — the prompt RPC fails later, on a detached promise.
    await runtime.startInitialTurn({ session, turn, message })

    await waitFor(
      () => (runtimeStates(runtime).size === 0 ? true : null),
      'runtime state cleanup after async prompt failure'
    )
    assert.equal(agentSessionService.getSessionDetail(session.id), null)
  } finally {
    await runtime.dispose()
  }
})

test('a slow-exiting old process cannot delete the replacement state after a reset', async () => {
  useScenario('delayed-exit')
  const runtime = new GrokRuntime()
  try {
    const { session, turn, message } = createSession('first question')
    await runtime.startInitialTurn({ session, turn, message })
    await waitForTurnStatus(session.id, turn.id, 'completed')

    // Old child gets SIGTERM here but lingers ~300ms before exiting.
    runtime.resetSession(session.id)
    useScenario('echo')

    const followupTurn = agentSessionService.startFollowupTurn({
      sessionId: session.id,
      message: 'second question'
    })
    const refreshed = detailOf(session.id)
    const followupMessage = refreshed.messages.find(
      (entry) => entry.turnId === followupTurn.id && entry.role === 'user'
    )
    assert.ok(followupMessage)
    await runtime.startTurn({ session: refreshed.session, turn: followupTurn, message: followupMessage })
    await waitForTurnStatus(session.id, followupTurn.id, 'completed')

    // Let the old process's delayed exit land, then verify the replacement
    // state survived it and still drives turns.
    await new Promise((resolve) => setTimeout(resolve, 600))
    assert.equal(runtimeStates(runtime).size, 1, 'replacement state must survive the stale exit')

    const thirdTurn = agentSessionService.startFollowupTurn({
      sessionId: session.id,
      message: 'third question'
    })
    const thirdDetail = detailOf(session.id)
    const thirdMessage = thirdDetail.messages.find(
      (entry) => entry.turnId === thirdTurn.id && entry.role === 'user'
    )
    assert.ok(thirdMessage)
    await runtime.startTurn({ session: thirdDetail.session, turn: thirdTurn, message: thirdMessage })
    const final = await waitForTurnStatus(session.id, thirdTurn.id, 'completed')
    const thirdAssistant = final.messages.find(
      (entry) => entry.role === 'assistant' && entry.turnId === thirdTurn.id
    )
    assert.equal(thirdAssistant?.text, 'ACK:third question')
  } finally {
    await runtime.dispose()
  }
})

test('interrupt cancels the in-flight prompt and marks the turn interrupted', async () => {
  useScenario('hang')
  const runtime = new GrokRuntime()
  try {
    const { session, turn, message } = createSession('never finishes')
    await runtime.startInitialTurn({ session, turn, message })

    await runtime.interrupt({ session })
    const detail = await waitForTurnStatus(session.id, turn.id, 'interrupted')
    assert.ok(detail.turns.every((entry) => entry.status !== 'running'))
  } finally {
    await runtime.dispose()
  }
})

test('after a reset the next turn resumes via session/load and replayed history is not re-recorded', async () => {
  useScenario('echo')
  const runtime = new GrokRuntime()
  try {
    const { session, turn, message } = createSession('first question')
    await runtime.startInitialTurn({ session, turn, message })
    await waitForTurnStatus(session.id, turn.id, 'completed')

    // Connector-change path: drop runtime state so the next turn re-establishes
    // the ACP session with fresh mcpServers via session/load.
    runtime.resetSession(session.id)
    const logPath = useScenario('echo')

    const followupTurn = agentSessionService.startFollowupTurn({
      sessionId: session.id,
      message: 'second question'
    })
    const refreshed = detailOf(session.id)
    const followupMessage = refreshed.messages.find(
      (entry) => entry.turnId === followupTurn.id && entry.role === 'user'
    )
    assert.ok(followupMessage)

    await runtime.startTurn({ session: refreshed.session, turn: followupTurn, message: followupMessage })
    const detail = await waitForTurnStatus(session.id, followupTurn.id, 'completed')

    const wire = readWireLog(logPath)
    assert.ok(
      wire.some((entry) => entry.method === 'session/load'),
      'resumed turn should re-establish the session via session/load'
    )
    assert.ok(
      detail.messages.every((entry) => !entry.text.includes('REPLAYED-HISTORY')),
      'history replayed during session/load must not be recorded again'
    )
    const followupAssistant = detail.messages.find(
      (entry) => entry.role === 'assistant' && entry.turnId === followupTurn.id
    )
    assert.equal(followupAssistant?.text, 'ACK:second question')
  } finally {
    await runtime.dispose()
  }
})
