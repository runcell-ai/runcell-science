import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildOpenCodePermissionRules,
  buildOpenCodeQuestionResolution,
  mergeOpenCodeText
} from '../src/runtime/providers/opencode/opencode-runtime'
import {
  isOpenCodeNotFound,
  isSupportedOpenCodeVersion,
  parseOpenCodeModelSlug,
  validateExternalOpenCodeServer
} from '../src/runtime/providers/opencode/opencode-server'

test('OpenCode model slugs preserve provider and nested model identifiers', () => {
  assert.deepEqual(parseOpenCodeModelSlug('anthropic/claude-sonnet-4-5'), {
    providerID: 'anthropic',
    modelID: 'claude-sonnet-4-5'
  })
  assert.deepEqual(parseOpenCodeModelSlug('custom/team/model'), {
    providerID: 'custom',
    modelID: 'team/model'
  })
  assert.equal(parseOpenCodeModelSlug('missing-provider'), null)
  assert.equal(parseOpenCodeModelSlug('/missing'), null)
})

test('OpenCode version gate accepts compatible updates and rejects old or new-major servers', () => {
  assert.equal(isSupportedOpenCodeVersion('1.18.4'), true)
  assert.equal(isSupportedOpenCodeVersion('1.19.0'), true)
  assert.equal(isSupportedOpenCodeVersion('1.18.3'), false)
  assert.equal(isSupportedOpenCodeVersion('2.0.0'), false)
  assert.equal(isSupportedOpenCodeVersion('dev'), false)
})

test('OpenCode not-found detection requires a structured 404 or exact tag', () => {
  assert.equal(isOpenCodeNotFound({ response: { status: 404 } }), true)
  assert.equal(isOpenCodeNotFound({ error: { _tag: 'NotFoundError' } }), true)
  assert.equal(isOpenCodeNotFound({ response: { status: 500 }, error: { _tag: 'NotFoundError' } }), false)
  assert.equal(isOpenCodeNotFound(new Error('404-ish text is not a structured signal')), false)
})

test('external OpenCode servers require secure transport and remote authentication', () => {
  assert.equal(
    validateExternalOpenCodeServer({ url: 'http://127.0.0.1:4096/', password: null }),
    'http://127.0.0.1:4096'
  )
  assert.equal(
    validateExternalOpenCodeServer({ url: 'https://agents.example.test/', password: 'secret' }),
    'https://agents.example.test'
  )
  assert.throws(
    () => validateExternalOpenCodeServer({ url: 'http://agents.example.test', password: 'secret' }),
    /must use HTTPS/
  )
  assert.throws(
    () => validateExternalOpenCodeServer({ url: 'https://agents.example.test', password: null }),
    /require OPENCODE_SERVER_PASSWORD/
  )
  assert.throws(
    () => validateExternalOpenCodeServer({ url: 'https://user:secret@agents.example.test', password: 'secret' }),
    /must not contain credentials/
  )
})

test('OpenCode permission rules never auto-approve default-mode tools', () => {
  assert.deepEqual(buildOpenCodePermissionRules('full_access'), [
    { permission: '*', pattern: '*', action: 'allow' }
  ])
  assert.deepEqual(buildOpenCodePermissionRules('default'), [
    { permission: '*', pattern: '*', action: 'ask' },
    { permission: 'question', pattern: '*', action: 'allow' }
  ])
})

test('OpenCode cumulative and delta text events do not duplicate assistant output', () => {
  assert.deepEqual(mergeOpenCodeText(undefined, 'hello'), { text: 'hello', delta: 'hello' })
  assert.deepEqual(mergeOpenCodeText('hello', 'hello world'), { text: 'hello world', delta: ' world' })
  assert.deepEqual(mergeOpenCodeText('hello world', 'hello'), { text: 'hello world', delta: '' })
  assert.deepEqual(mergeOpenCodeText('hello', ' world'), { text: 'hello world', delta: ' world' })
})

const oneQuestion = [
  {
    header: 'Dataset',
    question: 'Which dataset?',
    options: [
      { label: 'train.csv', description: 'Training data' },
      { label: 'test.csv', description: 'Test data' }
    ]
  }
]

test('OpenCode question resolution only sends an explicit answer or confirms one visible option', () => {
  assert.deepEqual(buildOpenCodeQuestionResolution(oneQuestion, { decision: 'answer', answer: 'test.csv' }), {
    action: 'reply',
    answers: [['test.csv']]
  })
  assert.deepEqual(buildOpenCodeQuestionResolution(oneQuestion, { decision: 'allow' }), { action: 'reject' })
  assert.deepEqual(
    buildOpenCodeQuestionResolution([{ ...oneQuestion[0]!, options: [oneQuestion[0]!.options[0]!] }], {
      decision: 'allow'
    }),
    { action: 'reply', answers: [['train.csv']] }
  )
  assert.deepEqual(buildOpenCodeQuestionResolution(oneQuestion, { decision: 'deny' }), { action: 'reject' })
  assert.deepEqual(buildOpenCodeQuestionResolution([...oneQuestion, ...oneQuestion], {
    decision: 'answer',
    answer: 'train.csv'
  }), { action: 'reject' })
  assert.deepEqual(buildOpenCodeQuestionResolution([...oneQuestion, ...oneQuestion], {
    decision: 'answer',
    answers: [['train.csv'], ['test.csv']]
  }), { action: 'reply', answers: [['train.csv'], ['test.csv']] })
  assert.deepEqual(buildOpenCodeQuestionResolution([
    { ...oneQuestion[0]!, multiple: true, custom: true }
  ], {
    decision: 'answer',
    answers: [['train.csv', 'a custom dataset']]
  }), { action: 'reply', answers: [['train.csv', 'a custom dataset']] })
  assert.deepEqual(buildOpenCodeQuestionResolution(oneQuestion, {
    decision: 'answer',
    answers: [['not-visible']]
  }), { action: 'reject' })
})
