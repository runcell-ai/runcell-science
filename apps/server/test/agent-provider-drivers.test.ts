import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import type {
  ResolvedAgentProviderConfig
} from '../src/services/agent-provider-config-service'
import {
  hasUnsafeWindowsShellMetacharacters,
  isWindowsCommandShimPath,
  runProviderProcess
} from '../src/runtime/provider-process-launch'
import {
  createBuiltinAgentProviderDrivers,
  sanitizeAgentProviderMessage,
  type AgentProviderProcessResult,
  type AgentProviderProcessRunner,
  type CodexProbeClient,
  type GrokProbeClient
} from '../src/services/agent-provider-drivers'

const ok = (stdout: string): AgentProviderProcessResult => ({
  stdout,
  stderr: '',
  exitCode: 0,
  errorCode: null,
  timedOut: false
})

function providerConfig(
  instanceId: 'grok' | 'codex' | 'claude',
  env: NodeJS.ProcessEnv = {}
): ResolvedAgentProviderConfig {
  return {
    instanceId,
    driver: instanceId,
    displayName: instanceId,
    configuredCommand: `/bin/${instanceId}`,
    resolvedExecutablePath: `/bin/${instanceId}`,
    commandSource: 'persisted',
    configHome: null,
    homeSource: 'default',
    configurationIssue: null,
    env
  }
}

class FakeProcessRunner implements AgentProviderProcessRunner {
  constructor(
    private readonly handler: (
      file: string,
      args: string[],
      env: NodeJS.ProcessEnv
    ) => AgentProviderProcessResult
  ) {}

  async exec(
    file: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv; cwd?: string; timeoutMs: number }
  ): Promise<AgentProviderProcessResult> {
    return this.handler(file, args, options.env)
  }
}

class FakeCodexClient implements CodexProbeClient {
  readonly methods: string[] = []

  on(): this {
    return this
  }

  async request<T>(method: string): Promise<T> {
    this.methods.push(method)
    if (method === 'account/read') {
      return {
        account: { type: 'apiKey' },
        requiresOpenaiAuth: false
      } as T
    }
    return {} as T
  }

  notify(): void {}
  dispose(): void {}
}

class FakeGrokClient implements GrokProbeClient {
  readonly methods: string[] = []

  constructor(
    private readonly errors: {
      initialize?: Error
      authenticate?: Error
    } = {}
  ) {}

  on(): this {
    return this
  }

  async request<T>(method: string): Promise<T> {
    this.methods.push(method)
    const error = this.errors[method as 'initialize' | 'authenticate']
    if (error) {
      throw error
    }
    return {} as T
  }

  dispose(): void {}
}

test('built-in probes normalize installed and authenticated state', async () => {
  const grokClient = new FakeGrokClient()
  const processRunner = new FakeProcessRunner((_file, args) => {
    if (args[0] === '--version') {
      return ok('provider 1.2.3\n')
    }
    if (args.join(' ') === 'auth status --json') {
      return ok('{"loggedIn":true,"authMethod":"claude.ai"}')
    }
    throw new Error(`Unexpected process call: ${args.join(' ')}`)
  })
  const drivers = createBuiltinAgentProviderDrivers({
    processRunner,
    codexManagementClient: {
      async request<T>() {
        return {
          account: { type: 'chatgpt', email: 'private@example.test', planType: 'plus' },
          requiresOpenaiAuth: true
        } as T
      }
    },
    grokClientFactory: () => grokClient
  })

  const snapshots = await Promise.all(
    drivers.map((driver) => driver.probe(providerConfig(driver.instanceId)))
  )
  assert.deepEqual(snapshots.map((snapshot) => snapshot.availability), ['ready', 'ready', 'ready'])
  assert.deepEqual(snapshots.map((snapshot) => snapshot.auth.status), [
    'authenticated',
    'authenticated',
    'authenticated'
  ])
  assert.deepEqual(grokClient.methods, ['initialize', 'authenticate'])
  assert.equal(JSON.stringify(snapshots).includes('private@example.test'), false)
})

test('probes distinguish missing binaries and explicit unauthenticated state', async () => {
  const missingRunner = new FakeProcessRunner(() => ({
    stdout: '',
    stderr: 'spawn ENOENT',
    exitCode: null,
    errorCode: 'ENOENT',
    timedOut: false
  }))
  const missingDrivers = createBuiltinAgentProviderDrivers({
    processRunner: missingRunner
  })
  for (const driver of missingDrivers) {
    const result = await driver.probe(providerConfig(driver.instanceId))
    assert.equal(result.installed, false)
    assert.equal(result.availability, 'not_installed')
  }

  const claudeRunner = new FakeProcessRunner((_file, args) =>
    args[0] === '--version'
      ? ok('2.1.218 (Claude Code)')
      : {
          stdout: '{"loggedIn":false,"authMethod":"none"}',
          stderr: '',
          exitCode: 1,
          errorCode: null,
          timedOut: false
        }
  )
  const claude = createBuiltinAgentProviderDrivers({
    processRunner: claudeRunner
  }).find((driver) => driver.instanceId === 'claude')
  assert.ok(claude)
  const unauthenticated = await claude.probe(providerConfig('claude'))
  assert.equal(unauthenticated.availability, 'needs_auth')
  assert.equal(unauthenticated.auth.status, 'unauthenticated')
})

test('Codex custom auth and transient setup probe use the injected client factory', async () => {
  const transient = new FakeCodexClient()
  let managedCalls = 0
  const codex = createBuiltinAgentProviderDrivers({
    processRunner: new FakeProcessRunner(() => ok('codex-cli 0.144.1')),
    codexManagementClient: {
      async request<T>() {
        managedCalls += 1
        return { account: null, requiresOpenaiAuth: false } as T
      }
    },
    codexClientFactory: () => transient
  }).find((driver) => driver.instanceId === 'codex')
  assert.ok(codex)

  const custom = await codex.probe(providerConfig('codex'))
  assert.equal(custom.availability, 'ready')
  assert.equal(custom.auth.label, 'Authentication not required')
  assert.equal(managedCalls, 1)

  const candidate = await codex.probe(providerConfig('codex'), {
    useManagedClient: false
  })
  assert.equal(candidate.availability, 'ready')
  assert.deepEqual(transient.methods, ['initialize', 'account/read'])
  assert.equal(managedCalls, 1)
})

test('Grok maps recognizable auth failures to needs_auth and protocol failures to error', async () => {
  const processRunner = new FakeProcessRunner(() => ok('grok 0.2.112'))
  const authDriver = createBuiltinAgentProviderDrivers({
    processRunner,
    grokClientFactory: () => new FakeGrokClient({
      authenticate: new Error('Unauthorized: login token missing')
    })
  }).find((driver) => driver.instanceId === 'grok')
  assert.ok(authDriver)
  const authResult = await authDriver.probe(providerConfig('grok'))
  assert.equal(authResult.availability, 'needs_auth')
  assert.equal(authResult.auth.status, 'unauthenticated')

  const protocolDriver = createBuiltinAgentProviderDrivers({
    processRunner,
    grokClientFactory: () => new FakeGrokClient({
      authenticate: new Error('protocol version mismatch')
    })
  }).find((driver) => driver.instanceId === 'grok')
  assert.ok(protocolDriver)
  const protocolResult = await protocolDriver.probe(providerConfig('grok'))
  assert.equal(protocolResult.availability, 'error')
  assert.equal(protocolResult.auth.status, 'unknown')
})

test('Grok recognizes structured authentication error codes', async () => {
  for (const error of [
    Object.assign(new Error('ACP request rejected'), { code: 401 }),
    Object.assign(new Error('auth required: run grok login'), { code: -32000 }),
    Object.assign(new Error('token expired, please re-authenticate'), { code: -32000 })
  ]) {
    const driver = createBuiltinAgentProviderDrivers({
      processRunner: new FakeProcessRunner(() => ok('grok 0.2.112')),
      grokClientFactory: () => new FakeGrokClient({ authenticate: error })
    }).find((candidate) => candidate.instanceId === 'grok')
    assert.ok(driver)

    const result = await driver.probe(providerConfig('grok'))
    assert.equal(result.availability, 'needs_auth')
    assert.equal(result.auth.status, 'unauthenticated')
  }
})

test('Grok initialization and parse failures are never misclassified as login failures', async () => {
  const processRunner = new FakeProcessRunner(() => ok('grok 0.2.112'))
  for (const errors of [
    { initialize: new Error('Unauthorized response envelope during initialize') },
    { authenticate: new Error('Unexpected token in JSON at position 0') },
    { authenticate: new Error('connection reset') }
  ]) {
    const driver = createBuiltinAgentProviderDrivers({
      processRunner,
      grokClientFactory: () => new FakeGrokClient(errors)
    }).find((candidate) => candidate.instanceId === 'grok')
    assert.ok(driver)
    const result = await driver.probe(providerConfig('grok'))
    assert.equal(result.availability, 'error')
    assert.equal(result.auth.status, 'unknown')
  }
})

test('Claude external-provider flags parse booleans and remain unverified', async () => {
  const runner = new FakeProcessRunner((_file, args) =>
    args[0] === '--version'
      ? ok('2.1.218 (Claude Code)')
      : {
          stdout: '{}',
          stderr: '',
          exitCode: 1,
          errorCode: null,
          timedOut: false
        }
  )
  const driver = createBuiltinAgentProviderDrivers({ processRunner: runner })
    .find((candidate) => candidate.instanceId === 'claude')
  assert.ok(driver)

  for (const falseValue of ['false', '0']) {
    const result = await driver.probe(
      providerConfig('claude', { CLAUDE_CODE_USE_BEDROCK: falseValue })
    )
    assert.equal(result.availability, 'error')
    assert.equal(result.auth.status, 'unknown')
  }

  const external = await driver.probe(
    providerConfig('claude', { CLAUDE_CODE_USE_BEDROCK: 'true' })
  )
  assert.equal(external.availability, 'ready')
  assert.equal(external.auth.status, 'unknown')
  assert.equal(external.auth.label, 'External credentials configured')
})

test('Codex ready-without-account remains auth unknown instead of claiming a login', async () => {
  const driver = createBuiltinAgentProviderDrivers({
    processRunner: new FakeProcessRunner(() => ok('codex-cli 0.144.1')),
    codexManagementClient: {
      async request<T>() {
        return { account: null, requiresOpenaiAuth: false } as T
      }
    }
  }).find((candidate) => candidate.instanceId === 'codex')
  assert.ok(driver)

  const result = await driver.probe(providerConfig('codex'))
  assert.equal(result.availability, 'ready')
  assert.equal(result.auth.status, 'unknown')
})

test('probe failures bound output and redact environment secrets, emails, and JWTs', () => {
  const secret = 'xai-secret-value-123456'
  const jwt = 'abcdefgh.ijklmnop.qrstuvwx'
  const message = sanitizeAgentProviderMessage(
    new Error(`${secret} private@example.test ${jwt} ${'x'.repeat(1_000)}`),
    { XAI_API_KEY: secret }
  )
  assert.equal(message.includes(secret), false)
  assert.equal(message.includes('private@example.test'), false)
  assert.equal(message.includes(jwt), false)
  assert.ok(message.length <= 500)
  assert.equal(sanitizeAgentProviderMessage(undefined), 'undefined')
  assert.equal(
    sanitizeAgentProviderMessage('认证失败：请先登录'),
    '认证失败：请先登录'
  )
})

test('provider process launch preserves argv without shell interpretation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'open-science argv '))
  const binaryPath = path.join(root, 'echo argv')
  fs.writeFileSync(
    binaryPath,
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify(process.argv.slice(2)))
`,
    { mode: 0o755 }
  )
  const args = ['plain', 'with spaces', '$(echo unsafe)', 'x&y', '{"key":"value"}']
  try {
    const result = await runProviderProcess(binaryPath, args, {
      env: process.env,
      timeoutMs: 5_000,
      maxOutputBytes: 64 * 1024
    })
    assert.equal(result.exitCode, 0)
    assert.equal(result.errorCode, null)
    assert.deepEqual(JSON.parse(result.stdout), args)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('provider process timeout settles when a descendant keeps stdio open', async () => {
  const startedAt = Date.now()
  const result = await runProviderProcess(
    '/bin/sh',
    ['-c', 'sleep 2 & printf ready; while :; do sleep 1; done'],
    {
      env: process.env,
      timeoutMs: 500,
      maxOutputBytes: 64 * 1024
    }
  )
  assert.equal(result.timedOut, true)
  assert.equal(result.stdout, 'ready')
  assert.ok(Date.now() - startedAt < 1_200)
})

test('legacy Windows command-shim paths with shell metacharacters are rejected', () => {
  assert.equal(hasUnsafeWindowsShellMetacharacters('C:\\safe path\\agent.cmd'), false)
  assert.equal(hasUnsafeWindowsShellMetacharacters('C:\\unsafe&path\\agent.cmd'), true)
  assert.equal(isWindowsCommandShimPath('C:\\unsafe&path\\agent.cmd', 'win32'), true)
})

test('version timeouts normalize to bounded provider errors', async () => {
  const runner = new FakeProcessRunner(() => ({
    stdout: '',
    stderr: '',
    exitCode: null,
    errorCode: 'ETIMEDOUT',
    timedOut: true
  }))
  for (const driver of createBuiltinAgentProviderDrivers({ processRunner: runner })) {
    const result = await driver.probe(providerConfig(driver.instanceId as 'grok' | 'codex' | 'claude'))
    assert.equal(result.availability, 'error')
    assert.match(result.message ?? '', /timed out/i)
  }
})
