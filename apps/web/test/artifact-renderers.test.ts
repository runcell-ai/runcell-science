import assert from 'node:assert/strict'
import test from 'node:test'

import type { AgentArtifact } from '@open-science/contracts'

import {
  builtinRendererKeys,
  getArtifactRenderer,
  registerArtifactRenderer,
  rendererKeyForArtifact,
  resolveArtifactRenderer,
  type ArtifactRendererProps
} from '../src/lib/artifact-renderers'

function fileArtifact(overrides: Partial<AgentArtifact> = {}): AgentArtifact {
  return {
    id: 'artifact-1',
    sessionId: 'session-1',
    turnId: null,
    messageId: null,
    kind: 'markdown',
    source: 'file',
    path: 'reports/summary.md',
    url: null,
    title: 'Summary',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  } as AgentArtifact
}

test('artifacts without a renderer key map to built-in renderer keys by kind', () => {
  assert.equal(rendererKeyForArtifact(fileArtifact({ kind: 'image' })), builtinRendererKeys.image)
  assert.equal(rendererKeyForArtifact(fileArtifact({ kind: 'markdown' })), builtinRendererKeys.markdown)
  assert.equal(rendererKeyForArtifact(fileArtifact({ kind: 'pdf' })), builtinRendererKeys.embed)
  assert.equal(rendererKeyForArtifact(fileArtifact({ kind: 'html' })), builtinRendererKeys.embed)
  assert.equal(
    rendererKeyForArtifact(
      fileArtifact({ kind: 'url', source: 'url', path: null, url: 'https://example.com' } as Partial<AgentArtifact>)
    ),
    builtinRendererKeys.embed
  )
})

test('a declared renderer key wins over the kind mapping', () => {
  const artifact = fileArtifact({ rendererKey: 'test:generic-panel' })
  assert.equal(rendererKeyForArtifact(artifact), 'test:generic-panel')
})

test('unknown renderer keys resolve to an unsupported fallback', () => {
  const artifact = fileArtifact({ rendererKey: 'test:not-registered-anywhere' })
  const resolution = resolveArtifactRenderer(artifact)
  assert.equal(resolution.supported, false)
  assert.equal(resolution.key, 'test:not-registered-anywhere')
})

test('registered renderers resolve and deregister cleanly', () => {
  const Renderer = (_props: ArtifactRendererProps) => null
  const dispose = registerArtifactRenderer('test:generic-panel', Renderer)
  try {
    const resolution = resolveArtifactRenderer(fileArtifact({ rendererKey: 'test:generic-panel' }))
    assert.equal(resolution.supported, true)
    assert.equal(resolution.supported && resolution.Renderer, Renderer)
    assert.equal(getArtifactRenderer('test:generic-panel'), Renderer)
  } finally {
    dispose()
  }
  assert.equal(getArtifactRenderer('test:generic-panel'), null)
  assert.equal(resolveArtifactRenderer(fileArtifact({ rendererKey: 'test:generic-panel' })).supported, false)
})

test('disposing does not remove a renderer that replaced the original', () => {
  const First = (_props: ArtifactRendererProps) => null
  const Second = (_props: ArtifactRendererProps) => null
  const disposeFirst = registerArtifactRenderer('test:replaced', First)
  const disposeSecond = registerArtifactRenderer('test:replaced', Second)
  try {
    disposeFirst()
    assert.equal(getArtifactRenderer('test:replaced'), Second)
  } finally {
    disposeSecond()
  }
})
