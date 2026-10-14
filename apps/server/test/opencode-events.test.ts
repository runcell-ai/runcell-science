import assert from 'node:assert/strict'
import test from 'node:test'

import type { Event, Part } from '@opencode-ai/sdk/v2'

import { OpenCodeRuntime } from '../src/runtime/providers/opencode/opencode-runtime'
import { agentSessionService } from '../src/services'

test('OpenCode preserves repeated text deltas and reconciles the final snapshot', (t) => {
  const deltas: string[] = []
  const completed: string[] = []
  t.mock.method(agentSessionService, 'appendAssistantMessageDelta', (input: { delta: string }) => {
    deltas.push(input.delta)
  })
  t.mock.method(agentSessionService, 'completeAssistantMessageItem', (input: { text: string }) => {
    completed.push(input.text)
  })
  const state = {
    localSessionId: 'local',
    providerSessionId: 'upstream',
    activeTurnId: 'turn',
    interruptingTurnId: null,
    disposed: false,
    messageRoles: new Map([['message', 'assistant']]),
    parts: new Map<string, Part>(),
    emittedText: new Map<string, string>(),
    completedTextParts: new Set<string>()
  }
  const runtime = new OpenCodeRuntime() as unknown as {
    handleEvent(inputState: typeof state, event: Event): void
  }
  const part: Part = {
    id: 'part',
    sessionID: 'upstream',
    messageID: 'message',
    type: 'text',
    text: 'ha'
  }
  runtime.handleEvent(state, {
    id: 'initial',
    type: 'message.part.updated',
    properties: { sessionID: 'upstream', part, time: 0 }
  })
  for (const id of ['delta-1', 'delta-2']) {
    runtime.handleEvent(state, {
      id,
      type: 'message.part.delta',
      properties: { sessionID: 'upstream', messageID: 'message', partID: 'part', field: 'text', delta: 'ha' }
    })
  }
  runtime.handleEvent(state, {
    id: 'metadata',
    type: 'message.part.delta',
    properties: { sessionID: 'upstream', messageID: 'message', partID: 'part', field: 'metadata', delta: 'ignore' }
  })
  runtime.handleEvent(state, {
    id: 'complete',
    type: 'message.part.updated',
    properties: { sessionID: 'upstream', part: { ...part, text: 'hahaha', time: { start: 0, end: 1 } }, time: 1 }
  })

  assert.deepEqual(deltas, ['ha', 'ha', 'ha'])
  assert.deepEqual(completed, ['hahaha'])
})
