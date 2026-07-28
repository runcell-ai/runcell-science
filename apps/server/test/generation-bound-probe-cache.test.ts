import assert from 'node:assert/strict'
import test from 'node:test'

import { GenerationBoundProbeCache } from '../src/runtime/generation-bound-probe-cache'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

test('generation cache cancels invalidated probes and ignores their late cache writes', async () => {
  const cache = new GenerationBoundProbeCache<string>()
  const old = deferred<string>()
  let oldCancelled = false
  const oldPromise = cache.get(60_000, () => ({
    promise: old.promise,
    cancel: () => {
      oldCancelled = true
    }
  }), () => 1)

  cache.clear()
  assert.equal(oldCancelled, true)

  const current = deferred<string>()
  const currentPromise = cache.get(60_000, () => ({
    promise: current.promise,
    cancel: () => {}
  }), () => 2)

  old.resolve('old')
  assert.equal(await oldPromise, 'old')
  current.resolve('current')
  assert.equal(await currentPromise, 'current')

  let unexpectedFactoryCalls = 0
  const cached = await cache.get(60_000, () => {
    unexpectedFactoryCalls += 1
    return { promise: Promise.resolve('unexpected'), cancel: () => {} }
  }, () => 3)
  assert.equal(cached, 'current')
  assert.equal(unexpectedFactoryCalls, 0)
})

test('late old finally cannot clear the newer in-flight probe identity', async () => {
  const cache = new GenerationBoundProbeCache<string>()
  const old = deferred<string>()
  const oldPromise = cache.get(60_000, () => ({
    promise: old.promise,
    cancel: () => {}
  }))
  cache.clear()

  const current = deferred<string>()
  const currentPromise = cache.get(60_000, () => ({
    promise: current.promise,
    cancel: () => {}
  }))
  old.resolve('old')
  await oldPromise

  let replacementCalls = 0
  const joined = cache.get(60_000, () => {
    replacementCalls += 1
    return { promise: Promise.resolve('replacement'), cancel: () => {} }
  })
  assert.equal(joined, currentPromise)
  assert.equal(replacementCalls, 0)

  current.resolve('current')
  assert.equal(await joined, 'current')
})
