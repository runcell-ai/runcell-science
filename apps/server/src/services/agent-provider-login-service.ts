import crypto from 'node:crypto'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import type {
  AgentProviderInstanceId,
  AgentProviderLoginAttempt,
  AgentProviderLoginFlow
} from '@runcell-science/contracts'

import { readBoundedLines } from '../runtime/bounded-line-reader'
import { sanitizeProviderOutput } from '../runtime/provider-output-sanitizer'
import { spawnProviderProcess } from '../runtime/provider-process-launch'
import type { AccountLoginCompletedNotification } from '../runtime/providers/codex/generated/v2/AccountLoginCompletedNotification'
import type { CancelLoginAccountResponse } from '../runtime/providers/codex/generated/v2/CancelLoginAccountResponse'
import type { LoginAccountResponse } from '../runtime/providers/codex/generated/v2/LoginAccountResponse'
import {
  agentProviderConfigService,
  requireAgentProviderExecutable,
  type AgentProviderConfigService,
  type ResolvedAgentProviderConfig
} from './agent-provider-config-service'
import {
  getAgentProviderRegistry,
  type AgentProviderRegistry
} from './agent-provider-registry'
import {
  codexManagementClientService,
  type CodexManagementClientService
} from './codex-management-client-service'

const DEFAULT_ATTEMPT_TTL_MS = 10 * 60_000
const LOGIN_OUTPUT_LINE_BYTES = 64 * 1024
const LOGIN_REQUEST_TIMEOUT_MS = 60_000
const LOGIN_TERMINATE_GRACE_MS = 250
const LOGIN_TERMINATE_TIMEOUT_MS = 750

export class AgentProviderLoginError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number
  ) {
    super(message)
    this.name = 'AgentProviderLoginError'
  }
}

export interface AgentProviderLoginObserver {
  setFlow(flow: AgentProviderLoginFlow, message?: string | null): void
  complete(success: boolean, message?: string | null): void
}

export interface AgentProviderLoginController {
  cancel(): Promise<void>
}

export interface AgentProviderLoginStarter {
  start(
    instanceId: AgentProviderInstanceId,
    resolved: ResolvedAgentProviderConfig,
    observer: AgentProviderLoginObserver
  ): Promise<AgentProviderLoginController>
}

interface LoginAttemptState {
  attempt: AgentProviderLoginAttempt
  controller: AgentProviderLoginController | null
  expiryTimer: NodeJS.Timeout | null
}

export interface AgentProviderLoginServiceOptions {
  configService: Pick<AgentProviderConfigService, 'resolve'>
  registry: Pick<AgentProviderRegistry, 'refresh'>
  starter: AgentProviderLoginStarter
  now: () => Date
  attemptTtlMs: number
}

function isTerminal(status: AgentProviderLoginAttempt['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'expired' || status === 'cancelled'
}

function copyFlow(flow: AgentProviderLoginFlow | null): AgentProviderLoginFlow | null {
  return flow ? { ...flow } : null
}

function copyAttempt(attempt: AgentProviderLoginAttempt): AgentProviderLoginAttempt {
  return {
    ...attempt,
    flow: copyFlow(attempt.flow)
  }
}

function safeLoginUrl(value: string): string {
  if (value.length > 2_048) {
    throw new Error('Login URL is too long.')
  }
  const parsed = new URL(value)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Login URL must use HTTP or HTTPS.')
  }
  return parsed.toString()
}

function sanitizeLoginFlow(flow: AgentProviderLoginFlow): AgentProviderLoginFlow {
  if (flow.kind === 'browser') {
    return { kind: 'browser', url: safeLoginUrl(flow.url) }
  }
  if (flow.kind === 'device_code') {
    const userCode = sanitizeProviderOutput(flow.userCode, {}, 64)
    if (!/^[A-Za-z0-9-]{4,64}$/.test(userCode)) {
      throw new Error('Provider returned an invalid device code.')
    }
    return {
      kind: 'device_code',
      verificationUrl: safeLoginUrl(flow.verificationUrl),
      userCode
    }
  }
  if (flow.kind === 'external_process') {
    return {
      kind: 'external_process',
      message: sanitizeProviderOutput(flow.message, {}, 300)
    }
  }
  return {
    kind: 'manual',
    command: sanitizeProviderOutput(flow.command, {}, 300),
    message: sanitizeProviderOutput(flow.message, {}, 300)
  }
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
}

export function extractDeviceCodeFlow(
  value: string
): Extract<AgentProviderLoginFlow, { kind: 'device_code' }> | null {
  const plain = stripAnsi(value)
  const url = plain.match(/https?:\/\/[^\s<>"']+/i)?.[0]?.replace(/[),.;]+$/, '')
  const code = plain.match(
    /(?:user\s*code|enter(?:\s+the)?\s+code|\bcode)\s*(?:is|:)?\s*([A-Z0-9][A-Z0-9-]{3,31})\b/i
  )?.[1]
  return url && code
    ? {
        kind: 'device_code',
        verificationUrl: url,
        userCode: code.toUpperCase()
      }
    : null
}

export class BuiltinAgentProviderLoginStarter implements AgentProviderLoginStarter {
  constructor(
    private readonly codexClient: Pick<
      CodexManagementClientService,
      'request' | 'onNotification' | 'onExit'
    > = codexManagementClientService
  ) {}

  async start(
    instanceId: AgentProviderInstanceId,
    resolved: ResolvedAgentProviderConfig,
    observer: AgentProviderLoginObserver
  ): Promise<AgentProviderLoginController> {
    const binaryPath = requireAgentProviderExecutable(resolved)
    if (instanceId === 'codex') {
      return this.startCodex(observer)
    }
    if (instanceId === 'grok') {
      return this.startProcessLogin(
        binaryPath,
        ['login', '--device-auth'],
        resolved,
        observer,
        'grok'
      )
    }
    if (instanceId === 'claude') {
      observer.setFlow({
        kind: 'external_process',
        message: 'Complete the Claude Code sign-in in the browser opened by the local CLI.'
      })
      return this.startProcessLogin(
        binaryPath,
        ['auth', 'login', '--claudeai'],
        resolved,
        observer,
        'claude'
      )
    }
    throw new AgentProviderLoginError(
      'provider_login_unsupported',
      `${resolved.displayName} does not provide a login workflow.`,
      400
    )
  }

  private async startCodex(
    observer: AgentProviderLoginObserver
  ): Promise<AgentProviderLoginController> {
    let loginId: string | null = null
    let active = true
    let pendingCompletion: AccountLoginCompletedNotification | null = null

    const finish = (completion: AccountLoginCompletedNotification) => {
      if (!active) {
        return
      }
      active = false
      unsubscribeNotification()
      unsubscribeExit()
      observer.complete(
        completion.success,
        completion.success ? null : completion.error ?? 'CodeX sign-in failed.'
      )
    }
    const unsubscribeNotification = this.codexClient.onNotification((message) => {
      if (message.method !== 'account/login/completed') {
        return
      }
      const completion = message.params as AccountLoginCompletedNotification
      if (!loginId) {
        pendingCompletion = completion
        return
      }
      if (completion.loginId === loginId) {
        finish(completion)
      }
    })
    const unsubscribeExit = this.codexClient.onExit(() => {
      if (active) {
        active = false
        unsubscribeNotification()
        unsubscribeExit()
        observer.complete(false, 'CodeX sign-in stopped before it completed.')
      }
    })

    try {
      const response = await this.codexClient.request<LoginAccountResponse>(
        'account/login/start',
        { type: 'chatgptDeviceCode' },
        LOGIN_REQUEST_TIMEOUT_MS
      )
      if (response.type !== 'chatgptDeviceCode') {
        throw new Error('CodeX did not return a device-code login flow.')
      }
      loginId = response.loginId
      observer.setFlow({
        kind: 'device_code',
        verificationUrl: response.verificationUrl,
        userCode: response.userCode
      })
      const queuedCompletion = pendingCompletion as AccountLoginCompletedNotification | null
      if (queuedCompletion?.loginId === loginId) {
        finish(queuedCompletion)
      }
    } catch (error) {
      active = false
      unsubscribeNotification()
      unsubscribeExit()
      throw error
    }

    return {
      cancel: async () => {
        if (!active) {
          return
        }
        active = false
        unsubscribeNotification()
        unsubscribeExit()
        if (loginId) {
          await this.codexClient.request<CancelLoginAccountResponse>(
            'account/login/cancel',
            { loginId },
            LOGIN_REQUEST_TIMEOUT_MS
          )
        }
      }
    }
  }

  private async startProcessLogin(
    binaryPath: string,
    args: string[],
    resolved: ResolvedAgentProviderConfig,
    observer: AgentProviderLoginObserver,
    provider: 'grok' | 'claude'
  ): Promise<AgentProviderLoginController> {
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawnProviderProcess(binaryPath, args, {
        env: resolved.env,
        windowsHide: true
      })
    } catch (error) {
      throw new AgentProviderLoginError(
        'provider_login_start_failed',
        sanitizeProviderOutput(error, resolved.env),
        502
      )
    }

    let active = true
    let termination: Promise<void> | null = null
    let cleanedUp = false
    let output = ''
    let lastErrorLine: string | null = null
    const lineDisposers: Array<() => void> = []
    const cleanup = () => {
      if (cleanedUp) {
        return
      }
      cleanedUp = true
      for (const dispose of lineDisposers) {
        dispose()
      }
      child.off('error', handleError)
      child.off('close', handleClose)
    }
    const terminate = (): Promise<void> => {
      if (termination) {
        return termination
      }
      active = false
      termination = new Promise<void>((resolve) => {
        let killTimer: NodeJS.Timeout | null = null
        let finishTimer: NodeJS.Timeout | null = null
        let settled = false
        const finish = () => {
          if (settled) {
            return
          }
          settled = true
          if (killTimer) {
            clearTimeout(killTimer)
          }
          if (finishTimer) {
            clearTimeout(finishTimer)
          }
          child.off('close', finish)
          cleanup()
          child.stdin.destroy()
          child.stdout.destroy()
          child.stderr.destroy()
          resolve()
        }

        if (child.exitCode !== null || child.signalCode !== null) {
          finish()
          return
        }

        child.once('close', finish)
        child.kill('SIGTERM')
        killTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL')
          }
        }, LOGIN_TERMINATE_GRACE_MS)
        finishTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL')
          }
          finish()
        }, LOGIN_TERMINATE_TIMEOUT_MS)
      })
      return termination
    }
    const failOutput = () => {
      if (!active) {
        return
      }
      active = false
      observer.complete(false, `${resolved.displayName} login output exceeded the safe limit.`)
      void terminate()
    }
    const consumeLine = (line: string, stderr: boolean) => {
      const sanitized = sanitizeProviderOutput(line, resolved.env, 2_000)
      if (stderr && sanitized) {
        lastErrorLine = sanitized
      }
      if (provider !== 'grok' || !active) {
        return
      }
      output = `${output}\n${stripAnsi(line)}`.slice(-8_000)
      const flow = extractDeviceCodeFlow(output)
      if (flow) {
        observer.setFlow(flow)
      }
    }

    const handleError = (error: Error) => {
      if (!active) {
        return
      }
      active = false
      observer.complete(false, sanitizeProviderOutput(error, resolved.env))
      void terminate()
    }
    const handleClose = (code: number | null) => {
      if (!active) {
        cleanup()
        return
      }
      active = false
      cleanup()
      observer.complete(
        code === 0,
        code === 0
          ? null
          : lastErrorLine ?? `${resolved.displayName} sign-in exited with code ${code ?? 'unknown'}.`
      )
    }

    lineDisposers.push(
      readBoundedLines(
        child.stdout,
        LOGIN_OUTPUT_LINE_BYTES,
        (line) => consumeLine(line, false),
        failOutput
      ),
      readBoundedLines(
        child.stderr,
        LOGIN_OUTPUT_LINE_BYTES,
        (line) => consumeLine(line, true),
        failOutput
      )
    )
    child.on('error', handleError)
    child.on('close', handleClose)

    return {
      cancel: terminate
    }
  }
}

export class AgentProviderLoginService {
  private readonly options: AgentProviderLoginServiceOptions
  private readonly attempts = new Map<string, LoginAttemptState>()
  private readonly activeAttemptByInstance = new Map<string, string>()

  constructor(options: Partial<AgentProviderLoginServiceOptions> = {}) {
    this.options = {
      configService: options.configService ?? agentProviderConfigService,
      registry: options.registry ?? getAgentProviderRegistry(),
      starter: options.starter ?? new BuiltinAgentProviderLoginStarter(),
      now: options.now ?? (() => new Date()),
      attemptTtlMs: options.attemptTtlMs ?? DEFAULT_ATTEMPT_TTL_MS
    }
  }

  create(instanceId: AgentProviderInstanceId): AgentProviderLoginAttempt {
    const activeId = this.activeAttemptByInstance.get(instanceId)
    const active = activeId ? this.attempts.get(activeId) : null
    if (active && !isTerminal(active.attempt.status)) {
      throw new AgentProviderLoginError(
        'provider_login_in_progress',
        `A login attempt for ${instanceId} is already in progress.`,
        409
      )
    }

    const resolved = this.options.configService.resolve(instanceId)
    requireAgentProviderExecutable(resolved)
    const now = this.options.now()
    const attempt: AgentProviderLoginAttempt = {
      id: crypto.randomUUID(),
      instanceId,
      status: 'starting',
      flow: null,
      startedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.options.attemptTtlMs).toISOString(),
      finishedAt: null,
      message: null
    }
    const state: LoginAttemptState = {
      attempt,
      controller: null,
      expiryTimer: null
    }
    this.attempts.set(attempt.id, state)
    this.activeAttemptByInstance.set(instanceId, attempt.id)
    state.expiryTimer = setTimeout(() => {
      void this.finishAsExpired(state)
    }, this.options.attemptTtlMs)

    const observer: AgentProviderLoginObserver = {
      setFlow: (flow, message = null) => {
        if (isTerminal(state.attempt.status)) {
          return
        }
        try {
          state.attempt.flow = sanitizeLoginFlow(flow)
          state.attempt.status = 'awaiting_user'
          state.attempt.message = message ? sanitizeProviderOutput(message, resolved.env) : null
        } catch {
          this.finish(state, 'failed', 'Provider returned an invalid login flow.')
          void state.controller?.cancel().catch(() => {})
        }
      },
      complete: (success, message = null) => {
        void this.finishFromProvider(state, success, message, resolved.env)
      }
    }

    void this.options.starter
      .start(instanceId, resolved, observer)
      .then((controller) => {
        state.controller = controller
        if (
          state.attempt.status === 'failed' ||
          state.attempt.status === 'cancelled' ||
          state.attempt.status === 'expired'
        ) {
          void controller.cancel().catch(() => {})
        }
      })
      .catch((error) => {
        void this.finishFromProvider(state, false, error, resolved.env)
      })

    return copyAttempt(attempt)
  }

  get(
    instanceId: AgentProviderInstanceId,
    attemptId: string
  ): AgentProviderLoginAttempt {
    const state = this.requireAttempt(instanceId, attemptId)
    if (!isTerminal(state.attempt.status) && Date.parse(state.attempt.expiresAt) <= this.options.now().getTime()) {
      void this.finishAsExpired(state)
    }
    return copyAttempt(state.attempt)
  }

  async cancel(
    instanceId: AgentProviderInstanceId,
    attemptId: string
  ): Promise<AgentProviderLoginAttempt> {
    const state = this.requireAttempt(instanceId, attemptId)
    if (isTerminal(state.attempt.status)) {
      return copyAttempt(state.attempt)
    }
    this.finish(state, 'cancelled', 'Login cancelled.')
    await state.controller?.cancel().catch(() => {})
    return copyAttempt(state.attempt)
  }

  async dispose(): Promise<void> {
    const cancellations: Promise<void>[] = []
    for (const state of this.attempts.values()) {
      if (!isTerminal(state.attempt.status)) {
        this.finish(state, 'cancelled', 'Server stopped.')
        if (state.controller) {
          cancellations.push(state.controller.cancel().catch(() => {}))
        }
      }
    }
    await Promise.all(cancellations)
  }

  private requireAttempt(
    instanceId: AgentProviderInstanceId,
    attemptId: string
  ): LoginAttemptState {
    const state = this.attempts.get(attemptId)
    if (!state || state.attempt.instanceId !== instanceId) {
      throw new AgentProviderLoginError(
        'provider_login_attempt_not_found',
        'Agent Provider login attempt was not found.',
        404
      )
    }
    return state
  }

  private async finishFromProvider(
    state: LoginAttemptState,
    success: boolean,
    message: unknown,
    env: NodeJS.ProcessEnv
  ): Promise<void> {
    if (isTerminal(state.attempt.status)) {
      return
    }
    if (!success) {
      this.finish(
        state,
        'failed',
        sanitizeProviderOutput(message ?? 'Login failed.', env)
      )
      await state.controller?.cancel().catch(() => {})
      return
    }
    try {
      const snapshot = await this.options.registry.refresh(state.attempt.instanceId, { fresh: true })
      if (snapshot.auth.status === 'authenticated') {
        this.finish(state, 'succeeded', 'Signed in successfully.')
      } else {
        this.finish(
          state,
          'failed',
          snapshot.message ?? 'Login completed, but the Provider still reports that sign-in is required.'
        )
        await state.controller?.cancel().catch(() => {})
      }
    } catch (error) {
      this.finish(
        state,
        'failed',
        `Login completed but status refresh failed: ${sanitizeProviderOutput(error, env)}`
      )
      await state.controller?.cancel().catch(() => {})
    }
  }

  private async finishAsExpired(state: LoginAttemptState): Promise<void> {
    if (isTerminal(state.attempt.status)) {
      return
    }
    this.finish(state, 'expired', 'Login attempt expired.')
    await state.controller?.cancel().catch(() => {})
  }

  private finish(
    state: LoginAttemptState,
    status: 'succeeded' | 'failed' | 'expired' | 'cancelled',
    message: string
  ): void {
    if (isTerminal(state.attempt.status)) {
      return
    }
    state.attempt.status = status
    state.attempt.finishedAt = this.options.now().toISOString()
    state.attempt.message = sanitizeProviderOutput(message)
    if (state.expiryTimer) {
      clearTimeout(state.expiryTimer)
      state.expiryTimer = null
    }
    if (this.activeAttemptByInstance.get(state.attempt.instanceId) === state.attempt.id) {
      this.activeAttemptByInstance.delete(state.attempt.instanceId)
    }
  }
}

export const agentProviderLoginService = new AgentProviderLoginService()
