import assert from 'node:assert/strict'
import test from 'node:test'

import {
  shouldRecordThreadItemActivity,
  streamingNotificationMethods
} from '../src/runtime/providers/codex/codex-runtime'

function threadItem(type: string): Parameters<typeof shouldRecordThreadItemActivity>[0] {
  return { type } as Parameters<typeof shouldRecordThreadItemActivity>[0]
}

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
    'item/fileChange/patchUpdated',
    // Streamed output of these RPCs is NOT duplicated into their final
    // events; dropping the deltas would discard the only copy.
    'command/exec/outputDelta',
    'process/outputDelta'
  ]
  for (const method of mustKeep) {
    assert.ok(!streamingNotificationMethods.has(method), `${method} must not be filtered`)
  }
})

test('transcript thread item lifecycle events are not recorded as activity', () => {
  const transcriptItemTypes = ['userMessage', 'agentMessage', 'reasoning', 'plan', 'hookPrompt']

  for (const type of transcriptItemTypes) {
    assert.equal(
      shouldRecordThreadItemActivity(threadItem(type)),
      false,
      `${type} must stay out of the activity timeline`
    )
  }

  assert.equal(shouldRecordThreadItemActivity(threadItem('mcpToolCall')), true)
  assert.equal(shouldRecordThreadItemActivity(threadItem('commandExecution')), true)
})
