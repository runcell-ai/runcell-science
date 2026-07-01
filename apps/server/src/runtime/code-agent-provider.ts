import type {
  AgentMessage,
  AgentPendingRequest,
  AgentSession,
  AgentTurn,
  ResolveAgentRequestRequest
} from '@open-science/contracts'

export interface RuntimeStartInitialTurnInput {
  session: AgentSession
  turn: AgentTurn
  message: AgentMessage
}

export interface RuntimeStartTurnInput {
  session: AgentSession
  turn: AgentTurn
  message: AgentMessage
}

export interface RuntimeResolveRequestInput {
  session: AgentSession
  request: AgentPendingRequest
  resolution: ResolveAgentRequestRequest
}

export interface RuntimeInterruptInput {
  session: AgentSession
}

export interface CodeAgentProviderRuntime {
  startInitialTurn(input: RuntimeStartInitialTurnInput): Promise<void>
  startTurn(input: RuntimeStartTurnInput): Promise<void>
  resolveRequest(input: RuntimeResolveRequestInput): Promise<void>
  interrupt(input: RuntimeInterruptInput): Promise<void>
  dispose(): Promise<void>
}

export class RuntimeProviderError extends Error {
  constructor(
    readonly code: 'provider_unavailable' | 'provider_not_implemented' | 'provider_request_failed',
    message: string,
    readonly httpStatus: number,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'RuntimeProviderError'
  }
}
