#!/usr/bin/env node
/**
 * Minimal fake Grok Build agent speaking ndjson ACP over stdio, for tests.
 * Behavior is selected with FAKE_GROK_SCENARIO; every received message is
 * appended to FAKE_GROK_LOG (jsonl) when set, so tests can assert on the
 * exact wire traffic (methods called, permission responses, ...).
 *
 * Scenarios:
 * - echo (default): stream one agent_message_chunk, resolve prompt end_turn
 * - auth-fail: authenticate returns a JSON-RPC error
 * - session-new-fail: session/new returns a JSON-RPC error
 * - prompt-complete-fallback: never answer the session/prompt RPC; emit the
 *   private _x.ai/session/prompt_complete notification instead
 * - duplicate-completion: answer the RPC AND emit the private notification
 * - permission: raise session/request_permission (options from
 *   FAKE_GROK_PERMISSION_OPTIONS), finish the turn after the response
 * - hang: never settle the prompt; session/cancel resolves it as cancelled
 * - exit-mid-prompt: exit(1) after receiving session/prompt
 * - set-model-fail: session/set_model returns a JSON-RPC error
 * - prompt-fail: session/prompt returns a JSON-RPC error immediately
 * - delayed-exit: behaves like echo, but survives SIGTERM for ~300ms to
 *   widen the dispose→exit race window
 */
if (process.env.FAKE_GROK_SCENARIO === 'delayed-exit') {
  process.on('SIGTERM', () => {
    setTimeout(() => process.exit(0), 300)
  })
}
import fs from 'node:fs'
import readline from 'node:readline'

const scenario = process.env.FAKE_GROK_SCENARIO ?? 'echo'
const logPath = process.env.FAKE_GROK_LOG

function log(entry) {
  if (logPath) {
    fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`)
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function chunk(sessionId, text) {
  send({
    jsonrpc: '2.0',
    method: 'session/update',
    params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } }
  })
}

let nextAgentRequestId = 1000
const pendingAgentRequests = new Map()
let activePrompt = null

function handlePrompt(message) {
  const sessionId = message.params.sessionId
  const promptId = message.params._meta?.promptId

  switch (scenario) {
    case 'prompt-fail': {
      send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'fake agent: prompt rejected' } })
      return
    }
    case 'prompt-complete-fallback': {
      chunk(sessionId, 'FALLBACK-TEXT')
      send({
        jsonrpc: '2.0',
        method: '_x.ai/session/prompt_complete',
        params: { sessionId, promptId, stopReason: 'end_turn', agentResult: null }
      })
      return
    }
    case 'duplicate-completion': {
      chunk(sessionId, 'DUP-TEXT')
      send({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } })
      send({
        jsonrpc: '2.0',
        method: '_x.ai/session/prompt_complete',
        params: { sessionId, promptId, stopReason: 'end_turn', agentResult: null }
      })
      return
    }
    case 'permission': {
      const requestId = nextAgentRequestId++
      pendingAgentRequests.set(requestId, (response) => {
        log({ permissionResponse: response.result ?? null, permissionError: response.error ?? null })
        chunk(sessionId, 'TOOL-DONE')
        send({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } })
      })
      const options = JSON.parse(
        process.env.FAKE_GROK_PERMISSION_OPTIONS ??
          '[{"optionId":"opt-allow","kind":"allow_once"},{"optionId":"opt-reject","kind":"reject_once"}]'
      )
      send({
        jsonrpc: '2.0',
        id: requestId,
        method: 'session/request_permission',
        params: { sessionId, toolCall: { toolCallId: 'call-1', title: 'Run fake tool' }, options }
      })
      return
    }
    case 'hang': {
      activePrompt = message
      return
    }
    case 'exit-mid-prompt': {
      process.exit(1)
      return
    }
    default: {
      const text = (message.params.prompt ?? [])
        .map((block) => (typeof block.text === 'string' ? block.text : ''))
        .join('|')
      chunk(sessionId, `ACK:${text}`)
      send({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } })
    }
  }
}

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  if (!line.trim()) {
    return
  }
  const message = JSON.parse(line)
  log(message)

  // Response to an agent-initiated request (e.g. session/request_permission).
  if (message.id !== undefined && message.method === undefined) {
    const handler = pendingAgentRequests.get(message.id)
    if (handler) {
      pendingAgentRequests.delete(message.id)
      handler(message)
    }
    return
  }

  const respond = (result) => send({ jsonrpc: '2.0', id: message.id, result })
  const respondError = (code, text) => send({ jsonrpc: '2.0', id: message.id, error: { code, message: text } })

  switch (message.method) {
    case 'initialize':
      respond({
        protocolVersion: 1,
        authMethods: [{ id: 'cached_token', name: 'cached_token' }],
        agentCapabilities: { loadSession: true }
      })
      return
    case 'authenticate':
      if (scenario === 'auth-fail') {
        respondError(-32000, 'fake agent: not logged in')
        return
      }
      respond({})
      return
    case 'session/new':
      if (scenario === 'session-new-fail') {
        respondError(-32000, 'fake agent: session/new rejected')
        return
      }
      respond({
        sessionId: 'fake-acp-session',
        models: { currentModelId: 'grok-4.5', availableModels: [{ modelId: 'grok-4.5', name: 'Grok 4.5' }] }
      })
      return
    case 'session/load':
      // Replay history the way grok does, then resolve the load.
      chunk(message.params.sessionId, 'REPLAYED-HISTORY')
      respond({
        sessionId: message.params.sessionId,
        models: { currentModelId: 'grok-4.5', availableModels: [] }
      })
      return
    case 'session/set_model':
      if (scenario === 'set-model-fail') {
        respondError(-32000, 'fake agent: unknown model')
        return
      }
      respond({})
      return
    case 'session/prompt':
      handlePrompt(message)
      return
    case 'session/cancel':
      // Notification: settle the hanging prompt like grok does on cancel.
      if (activePrompt) {
        send({ jsonrpc: '2.0', id: activePrompt.id, result: { stopReason: 'cancelled' } })
        activePrompt = null
      }
      return
    default:
      if (message.id !== undefined) {
        respondError(-32601, `fake agent: unknown method ${message.method}`)
      }
  }
})
