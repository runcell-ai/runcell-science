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
    } else if (message.method === 'fail') {
      console.log(JSON.stringify({ id: message.id, error: { code: -32000, message: 'boom' } }))
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
