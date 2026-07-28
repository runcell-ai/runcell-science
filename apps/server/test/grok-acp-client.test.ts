import assert from 'node:assert/strict'
import fs, { chmodSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { ProviderRpcError } from '../src/runtime/provider-rpc-error'
import { GrokAcpClient, type GrokAcpMessage } from '../src/runtime/providers/grok/acp-client'

const fakeAgentPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-grok-agent.mjs')
chmodSync(fakeAgentPath, 0o755)

function makeClient(scenario: string): GrokAcpClient {
  const client = new GrokAcpClient({
    binaryPath: fakeAgentPath,
    env: { ...process.env, FAKE_GROK_SCENARIO: scenario }
  })
  // Transport errors surface through request() rejections in these tests.
  client.on('error', () => {})
  return client
}

function makeOversizedClient(stream: 'stdout' | 'stderr' = 'stdout'): GrokAcpClient {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-science-oversized-grok-'))
  const binaryPath = path.join(dir, 'grok')
  fs.writeFileSync(
    binaryPath,
    `#!/usr/bin/env node
process.stdin.once('data', () => process.${stream}.write('x'.repeat(${stream === 'stdout' ? '9 * 1024 * 1024' : '70 * 1024'})))
`,
    { mode: 0o755 }
  )
  const client = new GrokAcpClient({ binaryPath, env: process.env })
  client.on('error', () => {})
  return client
}

async function handshake(client: GrokAcpClient): Promise<string> {
  await client.request('initialize', { protocolVersion: 1 }, 5000)
  await client.request('authenticate', { methodId: 'cached_token' }, 5000)
  const setup = await client.request<{ sessionId: string }>('session/new', { cwd: '/tmp', mcpServers: [] }, 5000)
  return setup.sessionId
}

test('Grok ACP client round-trips requests and receives notifications', async () => {
  const client = makeClient('echo')
  try {
    const notifications: GrokAcpMessage[] = []
    client.on('notification', (message) => notifications.push(message as GrokAcpMessage))

    const sessionId = await handshake(client)
    assert.equal(sessionId, 'fake-acp-session')

    const response = await client.request<{ stopReason: string }>(
      'session/prompt',
      { sessionId, prompt: [{ type: 'text', text: 'hello' }] },
      5000
    )
    assert.equal(response.stopReason, 'end_turn')

    const update = notifications.find((entry) => entry.method === 'session/update')
    assert.ok(update, 'expected a session/update notification')
  } finally {
    client.dispose()
  }
})

test('Grok ACP client surfaces agent-initiated requests and routes responses back', async () => {
  const client = makeClient('permission')
  try {
    const serverRequests: GrokAcpMessage[] = []
    client.on('serverRequest', (message) => {
      const request = message as GrokAcpMessage
      serverRequests.push(request)
      client.respond(request.id ?? 0, { outcome: { outcome: 'selected', optionId: 'opt-allow' } })
    })

    const sessionId = await handshake(client)
    const response = await client.request<{ stopReason: string }>(
      'session/prompt',
      { sessionId, prompt: [{ type: 'text', text: 'run the tool' }] },
      5000
    )

    assert.equal(response.stopReason, 'end_turn')
    assert.equal(serverRequests.length, 1)
    assert.equal(serverRequests[0]?.method, 'session/request_permission')
  } finally {
    client.dispose()
  }
})

test('Grok ACP client rejects JSON-RPC error responses', async () => {
  const client = makeClient('auth-fail')
  try {
    await client.request('initialize', { protocolVersion: 1 }, 5000)
    await assert.rejects(
      client.request('authenticate', { methodId: 'cached_token' }, 5000),
      (error: unknown) =>
        error instanceof ProviderRpcError &&
        error.code === -32000 &&
        /not logged in/.test(error.message)
    )
  } finally {
    client.dispose()
  }
})

test('Grok ACP client rejects pending requests when the agent process exits', async () => {
  const client = makeClient('exit-mid-prompt')
  try {
    const sessionId = await handshake(client)
    await assert.rejects(
      client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'bye' }] }, 5000),
      /exited with code 1/
    )
  } finally {
    client.dispose()
  }
})

test('Grok ACP client times out requests the agent never answers', async () => {
  const client = makeClient('hang')
  try {
    const sessionId = await handshake(client)
    await assert.rejects(
      client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'zzz' }] }, 200),
      /timed out after 200ms/
    )
  } finally {
    client.dispose()
  }
})

test('Grok ACP transport terminates an oversized response line', async () => {
  const client = makeOversizedClient()
  try {
    await assert.rejects(
      client.request('initialize', {}, 5_000),
      /transport output limit/i
    )
  } finally {
    client.dispose()
  }
})

test('Grok ACP transport bounds stderr without emitting the raw payload', async () => {
  const client = makeOversizedClient('stderr')
  const stderrLines: string[] = []
  client.on('stderr', (line) => stderrLines.push(String(line)))
  try {
    await assert.rejects(
      client.request('initialize', {}, 5_000),
      /stderr exceeded the transport output limit/i
    )
    assert.deepEqual(stderrLines, [])
  } finally {
    client.dispose()
  }
})
