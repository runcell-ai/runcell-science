import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildServerRequestResolution,
  grokAssistantProviderItemId,
  resolveGrokAuthMethodId
} from '../src/runtime/providers/grok/grok-runtime'

test('Grok assistant provider item id is stable per local turn', () => {
  assert.equal(grokAssistantProviderItemId('turn_123'), 'grok:turn_123:assistant')
})

test('Grok auth method prefers XAI_API_KEY and falls back to cached token', () => {
  assert.equal(resolveGrokAuthMethodId({ XAI_API_KEY: 'xai-secret' }), 'xai.api_key')
  assert.equal(resolveGrokAuthMethodId({ XAI_API_KEY: '   ' }), 'cached_token')
  assert.equal(resolveGrokAuthMethodId({}), 'cached_token')
})

const permissionParams = {
  sessionId: 'acp_session',
  toolCall: { toolCallId: 'call_1', title: 'Run command' },
  options: [
    { optionId: 'opt_allow_always', kind: 'allow_always' },
    { optionId: 'opt_allow_once', kind: 'allow_once' },
    { optionId: 'opt_reject_once', kind: 'reject_once' }
  ]
}

test('Grok permission approval selects an allow option, preferring allow_once', () => {
  assert.deepEqual(
    buildServerRequestResolution('session/request_permission', permissionParams, { decision: 'allow' }),
    { outcome: { outcome: 'selected', optionId: 'opt_allow_once' } }
  )
})

test('Grok permission denial selects a reject option', () => {
  assert.deepEqual(
    buildServerRequestResolution('session/request_permission', permissionParams, { decision: 'deny' }),
    { outcome: { outcome: 'selected', optionId: 'opt_reject_once' } }
  )
})

test('Grok permission resolution cancels when the agent offered no options', () => {
  assert.deepEqual(
    buildServerRequestResolution('session/request_permission', { options: [] }, { decision: 'allow' }),
    { outcome: { outcome: 'cancelled' } }
  )
})

test('Grok permission denial never selects an allow option', () => {
  assert.deepEqual(
    buildServerRequestResolution(
      'session/request_permission',
      { options: [{ optionId: 'only-allow', kind: 'allow_once' }] },
      { decision: 'deny' }
    ),
    { outcome: { outcome: 'cancelled' } }
  )
})

test('Grok permission approval never selects a reject option', () => {
  assert.deepEqual(
    buildServerRequestResolution(
      'session/request_permission',
      { options: [{ optionId: 'only-reject', kind: 'reject_once' }] },
      { decision: 'allow' }
    ),
    { outcome: { outcome: 'cancelled' } }
  )
})

const askUserQuestionParams = {
  sessionId: 'acp_session',
  toolCallId: 'call_2',
  mode: 'default',
  questions: [
    {
      question: 'Which dataset should I use?',
      options: [{ label: 'train.csv' }, { label: 'test.csv' }]
    }
  ]
}

test('Grok ask_user_question answer maps to the xAI accepted response shape', () => {
  assert.deepEqual(
    buildServerRequestResolution('x.ai/ask_user_question', askUserQuestionParams, {
      decision: 'answer',
      answer: 'test.csv'
    }),
    { outcome: 'accepted', answers: { 'Which dataset should I use?': ['test.csv'] } }
  )
})

test('Grok ask_user_question cancels a bare Allow when multiple options exist', () => {
  // The request card does not display options, so Allow must not silently
  // pick one of several choices the user never saw.
  assert.deepEqual(
    buildServerRequestResolution('_x.ai/ask_user_question', askUserQuestionParams, { decision: 'allow' }),
    { outcome: 'cancelled' }
  )
})

test('Grok ask_user_question lets a bare Allow confirm the only option', () => {
  assert.deepEqual(
    buildServerRequestResolution(
      'x.ai/ask_user_question',
      {
        sessionId: 'acp_session',
        toolCallId: 'call_4',
        mode: 'default',
        questions: [{ question: 'Proceed with the plan?', options: [{ label: 'OK' }] }]
      },
      { decision: 'allow' }
    ),
    { outcome: 'accepted', answers: { 'Proceed with the plan?': ['OK'] } }
  )
})

test('Grok ask_user_question unwraps the { method, params } envelope some builds send', () => {
  assert.deepEqual(
    buildServerRequestResolution(
      'x.ai/ask_user_question',
      { method: 'x.ai/ask_user_question', params: askUserQuestionParams },
      { decision: 'answer', answer: 'test.csv' }
    ),
    { outcome: 'accepted', answers: { 'Which dataset should I use?': ['test.csv'] } }
  )
})

test('Grok ask_user_question denial cancels the question', () => {
  assert.deepEqual(
    buildServerRequestResolution('x.ai/ask_user_question', askUserQuestionParams, { decision: 'deny' }),
    { outcome: 'cancelled' }
  )
})

test('Grok ask_user_question cancels multi-question requests instead of fabricating answers', () => {
  const multiQuestionParams = {
    sessionId: 'acp_session',
    toolCallId: 'call_3',
    mode: 'default',
    questions: [
      { question: 'First question?', options: [{ label: 'A' }] },
      { question: 'Second question the user never saw?', options: [{ label: 'B' }] }
    ]
  }
  assert.deepEqual(
    buildServerRequestResolution('x.ai/ask_user_question', multiQuestionParams, {
      decision: 'answer',
      answer: 'A'
    }),
    { outcome: 'cancelled' }
  )
})

test('Grok ask_user_question cancels when there is neither an answer nor options', () => {
  assert.deepEqual(
    buildServerRequestResolution(
      'x.ai/ask_user_question',
      { sessionId: 's', toolCallId: 'c', mode: 'default', questions: [{ question: 'Free-form?', options: [] }] },
      { decision: 'allow' }
    ),
    { outcome: 'cancelled' }
  )
})
