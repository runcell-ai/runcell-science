import type { AgentProvider, AgentSession, ResolveAgentRequestRequest } from '@open-science/contracts'

import { agentSessionService } from '../services'
import type { CodeAgentProviderRuntime } from './code-agent-provider'
import {
  RuntimeProviderError,
  type RuntimeInterruptInput,
  type RuntimeResolveRequestInput,
  type RuntimeStartInitialTurnInput,
  type RuntimeStartTurnInput
} from './code-agent-provider'
import { CodexRuntime } from './providers/codex/codex-runtime'
import { ClaudeRuntime } from './providers/claude/claude-runtime'

export class RuntimeRegistry {
  private readonly runtimes = new Map<AgentProvider, CodeAgentProviderRuntime>()

  constructor() {
    this.runtimes.set('codex', new CodexRuntime())
    this.runtimes.set('claude', new ClaudeRuntime())
  }

  async startInitialTurn(input: RuntimeStartInitialTurnInput): Promise<void> {
    const runtime = this.requireRuntime(input.session.provider)
    await runtime.startInitialTurn(input)
  }

  async startTurn(input: RuntimeStartTurnInput): Promise<void> {
    const runtime = this.requireRuntime(input.session.provider)
    await runtime.startTurn(input)
  }

  async resolveRequest(
    session: AgentSession,
    requestId: string,
    resolution: ResolveAgentRequestRequest
  ): Promise<void> {
    const request = agentSessionService.getSessionDetail(session.id)?.pendingRequests.find((entry) => entry.id === requestId)
    if (!request) {
      return
    }

    const runtime = this.requireRuntime(session.provider)
    const input: RuntimeResolveRequestInput = {
      session,
      request,
      resolution
    }
    await runtime.resolveRequest(input)
  }

  async interrupt(input: RuntimeInterruptInput): Promise<void> {
    const runtime = this.requireRuntime(input.session.provider)
    await runtime.interrupt(input)
  }

  resetSession(session: AgentSession): void {
    const runtime = this.requireRuntime(session.provider)
    runtime.resetSession?.(session.id)
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.runtimes.values()].map((runtime) => runtime.dispose()))
  }

  private requireRuntime(provider: AgentProvider): CodeAgentProviderRuntime {
    const runtime = this.runtimes.get(provider)
    if (!runtime) {
      throw new RuntimeProviderError(
        'provider_not_implemented',
        `Provider runtime '${provider}' is not implemented yet.`,
        501
      )
    }

    return runtime
  }
}

export const runtimeRegistry = new RuntimeRegistry()
