import assert from 'node:assert/strict'
import test from 'node:test'

import { streamingNotificationMethods } from '../src/runtime/providers/codex/codex-runtime'

test('high-frequency streaming notifications are filtered from the timeline', () => {
  const mustFilter = [
    'item/commandExecution/outputDelta',
    'item/fileChange/outputDelta',
    'item/reasoning/textDelta',
    'item/reasoning/summaryTextDelta',
    'item/plan/delta',
    'item/mcpToolCall/progress'
  ]
  for (const method of mustFilter) {
    assert.ok(streamingNotificationMethods.has(method), `${method} must be filtered`)
  }
})

test('notifications with dedicated handlers or user value are not filtered', () => {
  const mustKeep = [
    // Streams into the assistant message via its own handler.
    'item/agentMessage/delta',
    'item/started',
    'item/completed',
    'turn/started',
    'turn/completed',
    'item/fileChange/patchUpdated'
  ]
  for (const method of mustKeep) {
    assert.ok(!streamingNotificationMethods.has(method), `${method} must not be filtered`)
  }
})
