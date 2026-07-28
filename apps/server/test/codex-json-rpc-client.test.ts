import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { CodexJsonRpcClient, type CodexJsonRpcMessage } from '../src/runtime/providers/codex/json-rpc-client'

function createFakeCodexBinary(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-science-fake-codex-'))
  const binaryPath = path.join(dir, 'codex')
  fs.writeFileSync(
    binaryPath,
    `#!/usr/bin/env node
process.stdin.setEncoding('utf8')
let buffer = ''
process.stdin.on('data', (chunk) => {
  buffer += chunk
  for (;;) {
    const index = buffer.indexOf('\\n')
    if (index === -1) break
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    if (!line.trim()) continue
    const message = JSON.parse(line)
    if (message.method === 'initialize') {
      console.log(JSON.stringify({ method: 'thread/status/changed', params: { status: 'ready' } }))
      console.log(JSON.stringify({ id: message.id, result: { ok: true } }))
    } else if (message.method === 'largeDiff') {
      console.log(JSON.stringify({ method: 'turn/diff/updated', params: { diff: 'x'.repeat(70 * 1024) } }))
      console.log(JSON.stringify({ id: message.id, result: { ok: true } }))
    } else if (message.method === 'fail') {
      console.log(JSON.stringify({ id: message.id, error: { code: -32000, message: 'boom' } }))
    } else if (message.method === 'missingErrorMessage') {
      console.log(JSON.stringify({ id: message.id, error: { code: 401 } }))
    } else if (message.method === 'notifyOnly') {
      console.error('notified')
    }
  }
})
`,
    { mode: 0o755 }
  )
  return binaryPath
}

function createOversizedCodexBinary(stream: 'stdout' | 'stderr' = 'stdout'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-science-oversized-codex-'))
  const binaryPath = path.join(dir, 'codex')
  fs.writeFileSync(
    binaryPath,
    `#!/usr/bin/env node
process.stdin.once('data', () => process.${stream}.write('x'.repeat(${stream === 'stdout' ? '9 * 1024 * 1024' : '70 * 1024'})))
`,
    { mode: 0o755 }
  )
  return binaryPath
}

test('Codex JSON-RPC client resolves responses, emits notifications, and rejects protocol errors', async () => {
  const client = new CodexJsonRpcClient({
    binaryPath: createFakeCodexBinary(),
    env: process.env
  })

  const notificationPromise = once(client, 'notification') as Promise<[CodexJsonRpcMessage]>
  const result = await client.request<{ ok: boolean }>('initialize', {})
  const [notification] = await notificationPromise

  assert.deepEqual(result, { ok: true })
  assert.equal(notification.method, 'thread/status/changed')

  await assert.rejects(() => client.request('fail', {}), /boom/)

  const stderrPromise = once(client, 'stderr') as Promise<[string]>
  client.notify('notifyOnly', {})
  const [stderrLine] = await stderrPromise
  assert.equal(stderrLine, 'notified')

  client.dispose()
})

test('Codex JSON-RPC transport accepts an ordinary diff larger than 64 KiB', async () => {
  const client = new CodexJsonRpcClient({
    binaryPath: createFakeCodexBinary(),
    env: process.env
  })
  try {
    const notificationPromise = once(client, 'notification') as Promise<[CodexJsonRpcMessage]>
    const result = await client.request<{ ok: boolean }>('largeDiff', {})
    const [notification] = await notificationPromise
    assert.deepEqual(result, { ok: true })
    assert.equal(notification.method, 'turn/diff/updated')
    assert.equal(
      (notification.params as { diff: string }).diff.length,
      70 * 1024
    )
  } finally {
    client.dispose()
  }
})

test('Codex JSON-RPC transport safely rejects an error envelope with no message', async () => {
  const client = new CodexJsonRpcClient({
    binaryPath: createFakeCodexBinary(),
    env: process.env
  })
  try {
    await assert.rejects(
      client.request('missingErrorMessage', {}),
      /undefined/
    )
  } finally {
    client.dispose()
  }
})

test('Codex JSON-RPC transport terminates an oversized response line', async () => {
  const client = new CodexJsonRpcClient({
    binaryPath: createOversizedCodexBinary(),
    env: process.env
  })
  client.on('error', () => {})
  try {
    await assert.rejects(
      client.request('initialize', {}, 5_000),
      /transport output limit/i
    )
  } finally {
    client.dispose()
  }
})

test('Codex JSON-RPC transport bounds stderr without emitting the raw payload', async () => {
  const client = new CodexJsonRpcClient({
    binaryPath: createOversizedCodexBinary('stderr'),
    env: process.env
  })
  const stderrLines: string[] = []
  client.on('stderr', (line) => stderrLines.push(String(line)))
  client.on('error', () => {})
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
