import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import fastify from 'fastify'

process.env.SQLITE_PATH = path.join(os.tmpdir(), `open-science-jupyter-route-${process.pid}.sqlite`)
process.env.CHECKPOINT_GIT_DIR = path.join(os.tmpdir(), `open-science-jupyter-route-checkpoints-${process.pid}.git`)
process.env.SERVER_PORT = '27991'
process.env.LOG_LEVEL = 'silent'

const [
  { runMigrations },
  { closeDb, getDb },
  { jupyterRoute, knownWorkspaceRealpathForCwd },
  { agentIntegrationEnv },
  { agentSessionService },
  { sessionEventBus }
] =
  await Promise.all([
    import('../src/db/migrate'),
    import('../src/db/connection'),
    import('../src/http/routes/jupyter'),
    import('../src/runtime/env-utils'),
    import('../src/services'),
    import('../src/runtime')
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
  rmSync(process.env.SQLITE_PATH as string, { force: true })
})

async function makeServer() {
  const server = fastify({ logger: false })
  await server.register(jupyterRoute)
  return server
}

test('workspace jupyter endpoints reject missing and relative cwd values', async () => {
  const server = await makeServer()
  try {
    const missing = await server.inject({ method: 'GET', url: '/api/jupyter/workspace' })
    assert.equal(missing.statusCode, 400)
    assert.equal(missing.json().error.code, 'bad_request')

    const relative = await server.inject({
      method: 'POST',
      url: '/api/jupyter/workspace',
      payload: { cwd: 'relative/path' }
    })
    assert.equal(relative.statusCode, 400)
    assert.equal(relative.json().error.code, 'bad_request')
  } finally {
    await server.close()
  }
})

test('workspace jupyter endpoints 404 for cwd not attached to a known visible session', async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'open-science-jupyter-route-workspace-'))
  const server = await makeServer()
  try {
    const status = await server.inject({
      method: 'GET',
      url: `/api/jupyter/workspace?cwd=${encodeURIComponent(workspace)}`
    })
    assert.equal(status.statusCode, 404)
    assert.equal(status.json().error.code, 'not_found')

    const ensure = await server.inject({
      method: 'POST',
      url: '/api/jupyter/workspace',
      payload: { cwd: workspace }
    })
    assert.equal(ensure.statusCode, 404)
    assert.equal(ensure.json().error.code, 'not_found')
  } finally {
    await server.close()
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('workspace execution endpoint rejects unknown cwd and bad payloads', async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'open-science-jupyter-route-exec-bad-'))
  const server = await makeServer()
  try {
    const unknown = await server.inject({
      method: 'POST',
      url: '/api/jupyter/workspace/execution',
      payload: {
        cwd: workspace,
        notebook: 't.ipynb',
        mode: 'exec-cell',
        cellId: 'cell-1',
        status: 'ok',
        executionCount: 1,
        durationMs: 5,
        outputs: [],
        truncated: false
      }
    })
    assert.equal(unknown.statusCode, 404)

    const response = agentSessionService.createPendingSessionForInitialMessage({
      provider: 'codex',
      cwd: workspace,
      initialMessage: 'run notebook',
      model: null,
      runtimeMode: 'full_access'
    })
    const turn = response.detail.turns[0]
    assert.ok(turn)
    agentSessionService.appendAssistantMessageDelta({
      sessionId: response.sessionId,
      turnId: turn.id,
      provider: 'codex',
      delta: 'working',
      providerItemId: 'assistant'
    })

    const badNotebook = await server.inject({
      method: 'POST',
      url: '/api/jupyter/workspace/execution',
      payload: {
        cwd: workspace,
        notebook: '../bad.ipynb',
        mode: 'exec-cell',
        cellId: 'cell-1',
        status: 'ok',
        executionCount: 1,
        durationMs: 5,
        outputs: [],
        truncated: false
      }
    })
    assert.equal(badNotebook.statusCode, 400)

    const badMode = await server.inject({
      method: 'POST',
      url: '/api/jupyter/workspace/execution',
      payload: {
        cwd: workspace,
        notebook: 't.ipynb',
        mode: 'run-cell',
        cellId: 'cell-1',
        status: 'ok',
        executionCount: 1,
        durationMs: 5,
        outputs: [],
        truncated: false
      }
    })
    assert.equal(badMode.statusCode, 400)
  } finally {
    await server.close()
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('workspace execution endpoint persists detailJson and publishes notebook.execution', async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'open-science-jupyter-route-exec-'))
  const server = await makeServer()
  let unsubscribe: (() => void) | null = null
  try {
    const response = agentSessionService.createPendingSessionForInitialMessage({
      provider: 'codex',
      cwd: workspace,
      initialMessage: 'run notebook',
      model: null,
      runtimeMode: 'full_access'
    })
    const turn = response.detail.turns[0]
    assert.ok(turn)
    agentSessionService.appendAssistantMessageDelta({
      sessionId: response.sessionId,
      turnId: turn.id,
      provider: 'codex',
      delta: 'working',
      providerItemId: 'assistant'
    })

    const published: unknown[] = []
    unsubscribe = sessionEventBus.subscribe(response.sessionId, (event) => published.push(event))

    const execution = await server.inject({
      method: 'POST',
      url: '/api/jupyter/workspace/execution',
      payload: {
        cwd: workspace,
        notebook: 'reports/t.ipynb',
        mode: 'exec-cell',
        cellId: 'plot-cell',
        status: 'ok',
        executionCount: 7,
        durationMs: 12,
        outputs: [{ output_type: 'stream', name: 'stdout', text: 'hello\n' }],
        truncated: false
      }
    })
    assert.equal(execution.statusCode, 204)

    const detail = agentSessionService.getSessionDetail(response.sessionId)
    const event = detail?.events.find((entry) => entry.eventType === 'notebook.execution')
    assert.ok(event)
    assert.equal(event.turnId, turn.id)
    assert.equal(event.title, 'Notebook execution')
    assert.equal(event.summary, 'reports/t.ipynb · plot-cell · ok')
    assert.equal(event.status, 'ok')
    assert.equal(JSON.parse(event.detailJson ?? '{}').outputs[0].text, 'hello\n')

    const sse = published.find((entry: any) => entry.type === 'notebook.execution') as any
    assert.ok(sse)
    assert.equal(sse.event.id, event.id)
    assert.equal(JSON.parse(sse.event.detailJson).notebook, 'reports/t.ipynb')
  } finally {
    unsubscribe?.()
    await server.close()
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('knownWorkspaceRealpathForCwd matches by realpath', () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'open-science-jupyter-route-known-'))
  try {
    mkdirSync(path.join(workspace, 'child'))
    assert.equal(knownWorkspaceRealpathForCwd(workspace, [{ cwd: workspace }]), realpathSync(workspace))
    assert.equal(knownWorkspaceRealpathForCwd(path.join(workspace, 'child'), [{ cwd: workspace }]), null)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('agentIntegrationEnv exposes API URL and absolute nbcli script path', () => {
  const env = agentIntegrationEnv()
  assert.equal(env.OPEN_SCIENCE_API_URL, 'http://127.0.0.1:27991')
  assert.ok(path.isAbsolute(env.OPEN_SCIENCE_NBCLI as string))
  assert.equal(path.basename(env.OPEN_SCIENCE_NBCLI as string), 'nbcli.mjs')
})
