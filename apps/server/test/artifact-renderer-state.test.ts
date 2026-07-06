import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import fastify from 'fastify'

process.env.SQLITE_PATH = path.join(os.tmpdir(), `open-science-artifact-state-test-${process.pid}.sqlite`)
process.env.CHECKPOINT_GIT_DIR = path.join(os.tmpdir(), `open-science-artifact-state-checkpoints-${process.pid}.git`)
process.env.LOG_LEVEL = 'silent'

const [
  { runMigrations },
  { closeDb, getDb },
  { AgentSessionRepository },
  { AgentSessionService, AgentSessionServiceError, maxArtifactStateBytes, agentSessionService },
  { sessionsRoute },
  { sessionEventBus }
] = await Promise.all([
  import('../src/db/migrate'),
  import('../src/db/connection'),
  import('../src/services/agent-session-repository'),
  import('../src/services/agent-session-service'),
  import('../src/http/routes/sessions'),
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

function createSession(service: InstanceType<typeof AgentSessionService>, cwd = os.tmpdir()) {
  const response = service.createPendingSessionForInitialMessage({
    provider: 'codex',
    cwd,
    initialMessage: 'make an artifact',
    model: null,
    runtimeMode: 'full_access'
  })
  return response.sessionId
}

test('artifacts persist renderer key, media type, metadata, and editability', () => {
  const repository = new AgentSessionRepository()
  const service = new AgentSessionService(repository)
  const sessionId = createSession(service)

  const artifact = service.createArtifact({
    sessionId,
    kind: 'markdown',
    source: 'file',
    path: 'reports/summary.md',
    title: 'Summary',
    rendererKey: 'test:generic-panel',
    mediaType: 'text/markdown',
    metadataJson: JSON.stringify({ columns: 3 }),
    editable: true
  })

  assert.equal(artifact.rendererKey, 'test:generic-panel')
  assert.equal(artifact.mediaType, 'text/markdown')
  assert.deepEqual(artifact.metadata, { columns: 3 })
  assert.equal(artifact.editable, true)

  const projected = repository.findSessionDetail(sessionId)?.artifacts[0]
  assert.equal(projected?.rendererKey, 'test:generic-panel')
  assert.deepEqual(projected?.metadata, { columns: 3 })
  assert.equal(projected?.editable, true)
})

test('artifact dedupe updates preserve renderer fields unless overridden', () => {
  const repository = new AgentSessionRepository()
  const service = new AgentSessionService(repository)
  const sessionId = createSession(service)

  const first = service.createArtifact({
    sessionId,
    kind: 'html',
    source: 'file',
    path: 'panel/data.json',
    rendererKey: 'test:generic-panel',
    mediaType: 'application/json',
    metadataJson: JSON.stringify({ version: 1 }),
    editable: true
  })

  // Re-registering the same file without renderer fields keeps them.
  const second = service.createArtifact({
    sessionId,
    kind: 'html',
    source: 'file',
    path: 'panel/data.json',
    title: 'Data panel'
  })
  assert.equal(second.id, first.id)
  assert.equal(second.rendererKey, 'test:generic-panel')
  assert.deepEqual(second.metadata, { version: 1 })
  assert.equal(second.editable, true)

  // Providing new metadata overrides the stored copy.
  const third = service.createArtifact({
    sessionId,
    kind: 'html',
    source: 'file',
    path: 'panel/data.json',
    metadataJson: JSON.stringify({ version: 2 }),
    editable: false
  })
  assert.deepEqual(third.metadata, { version: 2 })
  assert.equal(third.editable, false)
})

test('artifact state round-trips and stays scoped to its session', () => {
  const repository = new AgentSessionRepository()
  const service = new AgentSessionService(repository)
  const sessionId = createSession(service)
  const otherSessionId = createSession(service)

  const artifact = service.createArtifact({
    sessionId,
    kind: 'html',
    source: 'file',
    path: 'panel/data.json',
    rendererKey: 'test:generic-panel',
    editable: true
  })

  const empty = service.getArtifactState(sessionId, artifact.id)
  assert.equal(empty.state, null)
  assert.equal(empty.updatedAt, null)

  const written = service.writeArtifactState({
    sessionId,
    artifactId: artifact.id,
    state: { selection: [1, 2, 3], note: 'hello' }
  })
  assert.deepEqual(written.state, { selection: [1, 2, 3], note: 'hello' })
  assert.ok(written.updatedAt)
  // The artifact timestamp moves so clients can key reloads on it.
  assert.ok(written.artifact.updatedAt >= artifact.updatedAt)

  const read = service.getArtifactState(sessionId, artifact.id)
  assert.deepEqual(read.state, { selection: [1, 2, 3], note: 'hello' })

  // The same artifact id is invisible from another session.
  assert.throws(
    () => service.getArtifactState(otherSessionId, artifact.id),
    (error) => error instanceof AgentSessionServiceError && error.code === 'not_found'
  )
  assert.throws(
    () => service.writeArtifactState({ sessionId: otherSessionId, artifactId: artifact.id, state: {} }),
    (error) => error instanceof AgentSessionServiceError && error.code === 'not_found'
  )
})

test('artifact state writes reject oversized payloads and publish artifact.updated', () => {
  const repository = new AgentSessionRepository()
  const service = new AgentSessionService(repository)
  const sessionId = createSession(service)
  const artifact = service.createArtifact({
    sessionId,
    kind: 'html',
    source: 'file',
    path: 'panel/data.json',
    editable: true
  })

  assert.throws(
    () =>
      service.writeArtifactState({
        sessionId,
        artifactId: artifact.id,
        state: { blob: 'x'.repeat(maxArtifactStateBytes + 1) }
      }),
    (error) => error instanceof AgentSessionServiceError && error.code === 'bad_request'
  )

  const published: unknown[] = []
  const unsubscribe = sessionEventBus.subscribe(sessionId, (event) => published.push(event))
  try {
    service.writeArtifactState({ sessionId, artifactId: artifact.id, state: { ok: true } })
  } finally {
    unsubscribe()
  }

  const updated = published.find((entry: any) => entry.type === 'artifact.updated') as any
  assert.ok(updated)
  assert.equal(updated.artifact.id, artifact.id)
})

test('artifact updates carry a focus hint only when requested', () => {
  const repository = new AgentSessionRepository()
  const service = new AgentSessionService(repository)
  const sessionId = createSession(service)

  const published: any[] = []
  const unsubscribe = sessionEventBus.subscribe(sessionId, (event) => published.push(event))
  try {
    service.createArtifact({
      sessionId,
      kind: 'url',
      source: 'url',
      url: 'https://example.com/panel'
    })
    service.createArtifact({
      sessionId,
      kind: 'url',
      source: 'url',
      url: 'https://example.com/panel'
    })
    service.createArtifact({
      sessionId,
      kind: 'url',
      source: 'url',
      url: 'https://example.com/panel',
      focus: true
    })
  } finally {
    unsubscribe()
  }

  const events = published.filter((entry) => entry.type === 'artifact.created' || entry.type === 'artifact.updated')
  assert.equal(events.length, 3)
  assert.equal(events[0].type, 'artifact.created')
  assert.equal(events[1].type, 'artifact.updated')
  assert.equal(events[1].focus, undefined)
  assert.equal(events[2].type, 'artifact.updated')
  assert.equal(events[2].focus, true)
})

async function makeServer() {
  const server = fastify({ logger: false })
  await server.register(sessionsRoute)
  return server
}

test('artifact routes accept renderer fields and serve scoped state', async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'open-science-artifact-route-'))
  const server = await makeServer()
  try {
    writeFileSync(path.join(workspace, 'panel.html'), '<html></html>')
    const sessionId = createSession(agentSessionService, workspace)
    const otherSessionId = createSession(agentSessionService, workspace)

    const created = await server.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/artifacts`,
      payload: {
        path: 'panel.html',
        rendererKey: 'test:generic-panel',
        mediaType: 'text/html',
        metadata: { layout: 'grid' },
        editable: true
      }
    })
    assert.equal(created.statusCode, 201)
    const artifact = created.json().artifact
    assert.equal(artifact.rendererKey, 'test:generic-panel')
    assert.equal(artifact.mediaType, 'text/html')
    assert.deepEqual(artifact.metadata, { layout: 'grid' })
    assert.equal(artifact.editable, true)

    const emptyState = await server.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/artifacts/${artifact.id}/state`
    })
    assert.equal(emptyState.statusCode, 200)
    assert.equal(emptyState.json().state, null)

    const put = await server.inject({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/artifacts/${artifact.id}/state`,
      payload: { state: { page: 2 } }
    })
    assert.equal(put.statusCode, 200)
    assert.deepEqual(put.json().state, { page: 2 })

    const read = await server.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/artifacts/${artifact.id}/state`
    })
    assert.equal(read.statusCode, 200)
    assert.deepEqual(read.json().state, { page: 2 })
    assert.ok(read.json().updatedAt)

    // State is invisible through another session's scope.
    const crossRead = await server.inject({
      method: 'GET',
      url: `/api/sessions/${otherSessionId}/artifacts/${artifact.id}/state`
    })
    assert.equal(crossRead.statusCode, 404)
    const crossWrite = await server.inject({
      method: 'PUT',
      url: `/api/sessions/${otherSessionId}/artifacts/${artifact.id}/state`,
      payload: { state: { page: 9 } }
    })
    assert.equal(crossWrite.statusCode, 404)

    const missingState = await server.inject({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/artifacts/${artifact.id}/state`,
      payload: { other: true }
    })
    assert.equal(missingState.statusCode, 400)

    const oversized = await server.inject({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/artifacts/${artifact.id}/state`,
      payload: { state: { blob: 'x'.repeat(maxArtifactStateBytes + 1) } }
    })
    assert.equal(oversized.statusCode, 400)
  } finally {
    await server.close()
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('artifact routes reject malformed renderer fields', async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'open-science-artifact-route-bad-'))
  const server = await makeServer()
  try {
    writeFileSync(path.join(workspace, 'panel.html'), '<html></html>')
    const sessionId = createSession(agentSessionService, workspace)

    const badKey = await server.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/artifacts`,
      payload: { path: 'panel.html', rendererKey: 'not a valid key!' }
    })
    assert.equal(badKey.statusCode, 400)

    const badMediaType = await server.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/artifacts`,
      payload: { path: 'panel.html', mediaType: 'nonsense' }
    })
    assert.equal(badMediaType.statusCode, 400)

    const badMetadata = await server.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/artifacts`,
      payload: { path: 'panel.html', metadata: ['not', 'an', 'object'] }
    })
    assert.equal(badMetadata.statusCode, 400)

    // Plain artifacts without renderer fields still work as before.
    const plain = await server.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/artifacts`,
      payload: { path: 'panel.html' }
    })
    assert.equal(plain.statusCode, 201)
    assert.equal(plain.json().artifact.kind, 'html')
    assert.equal(plain.json().artifact.rendererKey, null)
    assert.equal(plain.json().artifact.editable, false)
  } finally {
    await server.close()
    rmSync(workspace, { recursive: true, force: true })
  }
})
