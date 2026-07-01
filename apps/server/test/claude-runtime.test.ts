import assert from 'node:assert/strict'
import test from 'node:test'

import {
  claudeAssistantProviderItemId,
  extractClaudeStreamTextDelta
} from '../src/runtime/providers/claude/claude-runtime'

test('Claude assistant provider item id is stable per local turn', () => {
  assert.equal(claudeAssistantProviderItemId('turn_123'), 'claude:turn_123:assistant')
})

test('Claude stream text delta projection ignores non-text stream events', () => {
  assert.equal(
    extractClaudeStreamTextDelta({
      type: 'stream_event',
      uuid: 'event_1',
      session_id: 'session_1',
      parent_tool_use_id: null,
      event: {
        type: 'content_block_delta',
        delta: {
          type: 'text_delta',
          text: 'hello'
        }
      }
    }),
    'hello'
  )

  assert.equal(
    extractClaudeStreamTextDelta({
      type: 'stream_event',
      uuid: 'event_2',
      session_id: 'session_1',
      parent_tool_use_id: null,
      event: {
        type: 'content_block_start',
        content_block: {
          type: 'text'
        }
      }
    }),
    null
  )
})
