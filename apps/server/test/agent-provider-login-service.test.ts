import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import type {
  AgentProviderLoginAttempt,
  AgentProviderLoginFlow,
  AgentProviderSnapshot
} from '@runcell-science/contracts'

import type { ResolvedAgentProviderConfig } from '../src/services/agent-provider-config-service'
import {
  AgentProviderLoginError,
  AgentProviderLoginService,
  BuiltinAgentProviderLoginStarter,
  extractDeviceCodeFlow,
  type AgentProviderLoginController,
  type AgentProviderLoginObserver,
  type AgentProviderLoginStarter
} from '../src/services/agent-provider-login-service'

function resolved(
  instanceId: 'grok' | 'codex' | 'claude',
  executablePath = `/bin/${instanceId}`
): ResolvedAgentProviderConfig {
  return {
    instanceId,
    driver: instanceId,
    displayName: instanceId,
    configuredCommand: executablePath,
    resolvedExecutablePath: executablePath,
    commandSource: 'persisted',
    configHome: null,
    homeSource: 'default',
    configurationIssue: null,
    env: {}
  }
}

function refreshedSnapshot(instanceId: string): AgentProviderSnapshot {
  return {
    instanceId,
    driver: instanceId,
    displayName: instanceId,
    installed: true,
    version: '1.0.0',
    configuredCommand: instanceId,
    resolvedExecutablePath: `/bin/${instanceId}`,
    configHome: null,
    commandSource: 'discovered',
    homeSource: 'default',
    availability: 'ready',
    auth: { status: 'authenticated' },
    refreshState: 'idle',
    checkedAt: new Date().toISOString(),
    lastSuccessfulAt: new Date().toISOString(),
    stale: false,
    message: null,
    capabilities: { login: true, localSetup: true, loginMode: 'device_code' },
    setup: { loginCommand: null, docsUrl: null, installInstructions: [] }
  }
}

class FakeStarter implements AgentProviderLoginStarter {
  observer: AgentProviderLoginObserver | null = null
  cancelled = 0

  async start(
    _instanceId: string,
    _resolved: ResolvedAgentProviderConfig,
    observer: AgentProviderLoginObserver
  ): Promise<AgentProviderLoginController> {
    this.observer = observer
    return {
      cancel: async () => {
        this.cancelled += 1
      }
    }
  }
}

class FakeCodexLoginClient {
  readonly requests: Array<{ method: string; params: unknown }> = []
  private readonly notifications = new Set<(message: any) => void>()
  private readonly exits = new Set<() => void>()

  onNotification(listener: (message: any) => void): () => void {
    this.notifications.add(listener)
    return () => this.notifications.delete(listener)
  }

  onExit(listener: () => void): () => void {
    this.exits.add(listener)
    return () => this.exits.delete(listener)
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    this.requests.push({ method, params })
    if (method === 'account/login/start') {
      return {
        type: 'chatgptDeviceCode',
        loginId: 'codex-login-1',
        verificationUrl: 'https://auth.openai.test/device',
        userCode: 'CODE-X123'
      } as T
    }
    return { status: 'canceled' } as T
  }

  emitNotification(message: unknown): void {
    for (const listener of this.notifications) {
      listener(message)
    }
  }
}

function serviceFixture(options: { now?: () => Date; ttl?: number } = {}) {
  const starter = new FakeStarter()
  let refreshes = 0
  const refreshOptions: Array<{ fresh?: boolean } | undefined> = []
  const service = new AgentProviderLoginService({
    configService: {
      resolve(instanceId) {
        return resolved(instanceId as 'grok' | 'codex' | 'claude')
      }
    },
    registry: {
      async refresh(instanceId, refreshOption) {
        refreshes += 1
        refreshOptions.push(refreshOption)
        return refreshedSnapshot(instanceId)
      }
    },
    starter,
    now: options.now,
    attemptTtlMs: options.ttl ?? 60_000
  })
  return { service, starter, refreshes: () => refreshes, refreshOptions }
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

test('login attempts expose observable flow, reject overlap, and finish after a fresh refresh', async () => {
  const { service, starter, refreshes, refreshOptions } = serviceFixture()
  try {
    const created = service.create('codex')
    assert.equal(created.status, 'starting')
    assert.equal(created.flow, null)
    await flush()

    const flow: AgentProviderLoginFlow = {
      kind: 'device_code',
      verificationUrl: 'https://example.test/device',
      userCode: 'ABCD-EFGH'
    }
    starter.observer?.setFlow(flow)
    const awaiting = service.get('codex', created.id)
    assert.equal(awaiting.status, 'awaiting_user')
    assert.deepEqual(awaiting.flow, flow)
    assert.throws(
      () => service.create('codex'),
      (error: unknown) =>
        error instanceof AgentProviderLoginError &&
        error.code === 'provider_login_in_progress' &&
        error.statusCode === 409
    )

    starter.observer?.complete(true)
    await flush()
    const finished = service.get('codex', created.id)
    assert.equal(finished.status, 'succeeded')
    assert.ok(finished.finishedAt)
    assert.equal(refreshes(), 1)
    assert.deepEqual(refreshOptions, [{ fresh: true }])

    const next = service.create('codex')
    assert.notEqual(next.id, created.id)
  } finally {
    await service.dispose()
  }
})

test('login attempts cancel and expire with controller cleanup', async () => {
  let now = new Date('2026-07-27T12:00:00.000Z')
  const { service, starter } = serviceFixture({ now: () => now, ttl: 60_000 })
  try {
    const cancelledAttempt = service.create('claude')
    await flush()
    const cancelled = await service.cancel('claude', cancelledAttempt.id)
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(starter.cancelled, 1)

    const expiring = service.create('grok')
    await flush()
    now = new Date('2026-07-27T12:02:00.000Z')
    const expired = service.get('grok', expiring.id)
    assert.equal(expired.status, 'expired')
    await flush()
    assert.equal(starter.cancelled, 2)
  } finally {
    await service.dispose()
  }
})

test('attempt lookup is scoped to the provider instance', async () => {
  const { service } = serviceFixture()
  try {
    const attempt = service.create('codex')
    assert.throws(
      () => service.get('grok', attempt.id),
      (error: unknown) =>
        error instanceof AgentProviderLoginError &&
        error.code === 'provider_login_attempt_not_found'
    )
  } finally {
    await service.dispose()
  }
})

test('invalid login flows fail safely and clean up the controller', async () => {
  const { service, starter } = serviceFixture()
  try {
    const attempt = service.create('codex')
    await flush()
    starter.observer?.setFlow({
      kind: 'browser',
      url: 'javascript:alert(1)'
    })
    await flush()
    assert.equal(service.get('codex', attempt.id).status, 'failed')
    assert.equal(starter.cancelled, 1)
  } finally {
    await service.dispose()
  }
})

test('provider completion only succeeds when refreshed auth is authenticated', async () => {
  const starter = new FakeStarter()
  const service = new AgentProviderLoginService({
    configService: {
      resolve() {
        return resolved('grok')
      }
    },
    registry: {
      async refresh() {
        return {
          ...refreshedSnapshot('grok'),
          availability: 'needs_auth',
          auth: { status: 'unauthenticated' },
          message: 'Sign in is still required.'
        }
      }
    },
    starter
  })
  try {
    const attempt = service.create('grok')
    await flush()
    starter.observer?.complete(true)
    await flush()
    const finished = service.get('grok', attempt.id)
    assert.equal(finished.status, 'failed')
    assert.equal(finished.message, 'Sign in is still required.')
  } finally {
    await service.dispose()
  }
})

test('device-code parser accepts URL and code across typical Grok output', () => {
  assert.deepEqual(
    extractDeviceCodeFlow(
      'Open https://auth.x.ai/device in a browser\nEnter the code ABCD-EFGH to continue'
    ),
    {
      kind: 'device_code',
      verificationUrl: 'https://auth.x.ai/device',
      userCode: 'ABCD-EFGH'
    }
  )
  assert.deepEqual(
    extractDeviceCodeFlow('\u001b[32mVerification: https://example.test/login — user code: xy9z-1234\u001b[0m'),
    {
      kind: 'device_code',
      verificationUrl: 'https://example.test/login',
      userCode: 'XY9Z-1234'
    }
  )
})

test('Grok process login publishes device flow and completion', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'open-science-login-'))
  const binaryPath = path.join(root, 'grok')
  fs.writeFileSync(
    binaryPath,
    `#!/bin/sh
printf 'Open https://auth.x.ai/device\\n'
printf 'Enter the code TEST-CODE\\n'
exit 0
`,
    { mode: 0o755 }
  )
  const flows: AgentProviderLoginFlow[] = []
  let completion: { success: boolean; message?: string | null } | null = null
  try {
    const starter = new BuiltinAgentProviderLoginStarter()
    await starter.start('grok', resolved('grok', binaryPath), {
      setFlow(flow) {
        flows.push(flow)
      },
      complete(success, message) {
        completion = { success, message }
      }
    })
    for (let index = 0; index < 60 && completion === null; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.deepEqual(flows.at(-1), {
      kind: 'device_code',
      verificationUrl: 'https://auth.x.ai/device',
      userCode: 'TEST-CODE'
    })
    assert.deepEqual(completion, { success: true, message: null })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

async function waitForFile(filePath: string): Promise<void> {
  for (let index = 0; index < 400; index += 1) {
    if (fs.existsSync(filePath)) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Timed out waiting for ${filePath}`)
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('process login cancellation escalates and terminates a child that ignores SIGTERM', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'open-science-login-cancel-'))
  const binaryPath = path.join(root, 'grok')
  const pidPath = path.join(root, 'pid')
  let pid: number | null = null
  fs.writeFileSync(
    binaryPath,
    `#!/usr/bin/env node
const fs = require('node:fs')
fs.writeFileSync(process.env.LOGIN_PID_FILE, String(process.pid))
process.on('SIGTERM', () => {})
console.log('Open https://auth.x.ai/device')
console.log('Enter the code CANCEL-CODE')
setInterval(() => {}, 1000)
setTimeout(() => process.exit(0), 15000)
`,
    { mode: 0o755 }
  )

  try {
    const starter = new BuiltinAgentProviderLoginStarter()
    const controller = await starter.start(
      'grok',
      {
        ...resolved('grok', binaryPath),
        env: { ...process.env, LOGIN_PID_FILE: pidPath }
      },
      { setFlow() {}, complete() {} }
    )
    await waitForFile(pidPath)
    pid = Number(fs.readFileSync(pidPath, 'utf8'))
    assert.equal(processIsRunning(pid), true)

    await controller.cancel()
    assert.equal(processIsRunning(pid), false)
  } finally {
    if (pid !== null && processIsRunning(pid)) {
      process.kill(pid, 'SIGKILL')
    }
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('process login output overflow force-terminates the child and detaches readers', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'open-science-login-overflow-'))
  const binaryPath = path.join(root, 'grok')
  const pidPath = path.join(root, 'pid')
  let pid: number | null = null
  let completion: { success: boolean; message?: string | null } | null = null
  fs.writeFileSync(
    binaryPath,
    `#!/usr/bin/env node
const fs = require('node:fs')
fs.writeFileSync(process.env.LOGIN_PID_FILE, String(process.pid))
process.on('SIGTERM', () => {})
process.stdout.write('x'.repeat(70 * 1024))
setInterval(() => {}, 1000)
setTimeout(() => process.exit(0), 15000)
`,
    { mode: 0o755 }
  )

  try {
    const starter = new BuiltinAgentProviderLoginStarter()
    const controller = await starter.start(
      'grok',
      {
        ...resolved('grok', binaryPath),
        env: { ...process.env, LOGIN_PID_FILE: pidPath }
      },
      {
        setFlow() {},
        complete(success, message) {
          completion = { success, message }
        }
      }
    )
    await waitForFile(pidPath)
    pid = Number(fs.readFileSync(pidPath, 'utf8'))
    for (let index = 0; index < 60 && completion === null; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    await controller.cancel()

    assert.deepEqual(completion, {
      success: false,
      message: 'grok login output exceeded the safe limit.'
    })
    assert.equal(processIsRunning(pid), false)
  } finally {
    if (pid !== null && processIsRunning(pid)) {
      process.kill(pid, 'SIGKILL')
    }
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('CodeX login uses app-server device auth notifications and cancellation', async () => {
  const client = new FakeCodexLoginClient()
  const starter = new BuiltinAgentProviderLoginStarter(client)
  const flows: AgentProviderLoginFlow[] = []
  let completion: { success: boolean; message?: string | null } | null = null
  const controller = await starter.start('codex', resolved('codex'), {
    setFlow(flow) {
      flows.push(flow)
    },
    complete(success, message) {
      completion = { success, message }
    }
  })

  assert.deepEqual(client.requests[0], {
    method: 'account/login/start',
    params: { type: 'chatgptDeviceCode' }
  })
  assert.deepEqual(flows[0], {
    kind: 'device_code',
    verificationUrl: 'https://auth.openai.test/device',
    userCode: 'CODE-X123'
  })
  client.emitNotification({
    method: 'account/login/completed',
    params: {
      loginId: 'codex-login-1',
      success: true,
      error: null
    }
  })
  assert.deepEqual(completion, { success: true, message: null })
  await controller.cancel()
  assert.equal(client.requests.length, 1)

  const pendingController = await starter.start('codex', resolved('codex'), {
    setFlow() {},
    complete() {}
  })
  await pendingController.cancel()
  assert.deepEqual(client.requests.at(-1), {
    method: 'account/login/cancel',
    params: { loginId: 'codex-login-1' }
  })
})

test('attempt DTO copies cannot mutate service state', async () => {
  const { service, starter } = serviceFixture()
  try {
    const attempt = service.create('codex')
    await flush()
    starter.observer?.setFlow({
      kind: 'device_code',
      verificationUrl: 'https://example.test',
      userCode: 'COPY-CODE'
    })
    const first = service.get('codex', attempt.id)
    ;(first as AgentProviderLoginAttempt).status = 'failed'
    if (first.flow?.kind === 'device_code') {
      first.flow.userCode = 'MUTATED'
    }
    const second = service.get('codex', attempt.id)
    assert.equal(second.status, 'awaiting_user')
    assert.equal(
      second.flow?.kind === 'device_code' ? second.flow.userCode : null,
      'COPY-CODE'
    )
  } finally {
    await service.dispose()
  }
})
