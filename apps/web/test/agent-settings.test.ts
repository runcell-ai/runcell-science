import assert from 'node:assert/strict'
import test from 'node:test'

import type { AgentProviderSnapshot } from '@runcell-science/contracts'

import { isLoginAttemptExpired, setupTestOutcome } from '../src/lib/agent-settings-state'

function snapshot(
  availability: AgentProviderSnapshot['availability'],
  overrides: Partial<AgentProviderSnapshot> = {}
): AgentProviderSnapshot {
  return {
    instanceId: 'claude',
    driver: 'claude',
    displayName: 'Claude Code',
    installed: true,
    version: '2.1.218',
    configuredCommand: 'claude',
    resolvedExecutablePath: '/usr/local/bin/claude',
    configHome: null,
    commandSource: 'discovered',
    homeSource: 'default',
    availability,
    auth: { status: availability === 'ready' ? 'authenticated' : 'unknown' },
    refreshState: 'idle',
    checkedAt: null,
    lastSuccessfulAt: null,
    stale: false,
    message: null,
    capabilities: { login: true, localSetup: true, loginMode: 'local_process' },
    setup: { loginCommand: 'claude auth login --claudeai', docsUrl: null, installInstructions: [] },
    ...overrides
  }
}

test('setup Test only passes states that Save accepts', () => {
  assert.deepEqual(setupTestOutcome(snapshot('ready')), {
    kind: 'success',
    message: 'Test passed (2.1.218).'
  })
  assert.equal(setupTestOutcome(snapshot('needs_auth')).kind, 'success')
  assert.deepEqual(
    setupTestOutcome(
      snapshot('error', {
        message: 'Claude Code auth status could not be read.'
      })
    ),
    {
      kind: 'error',
      message: 'Claude Code auth status could not be read.'
    }
  )
  assert.equal(setupTestOutcome(snapshot('not_installed', { installed: false })).kind, 'error')
})

test('client-side login expiry stops polling at the server deadline', () => {
  const attempt = { expiresAt: '2026-07-27T12:01:00.000Z' }
  assert.equal(isLoginAttemptExpired(attempt, Date.parse('2026-07-27T12:00:59.999Z')), false)
  assert.equal(isLoginAttemptExpired(attempt, Date.parse('2026-07-27T12:01:00.000Z')), true)
})
