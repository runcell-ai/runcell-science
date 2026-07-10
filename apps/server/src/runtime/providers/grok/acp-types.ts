/**
 * Hand-written subset of the Agent Client Protocol (protocol version 1) plus
 * the xAI private extensions Grok Build layers on top of it. Grok has no
 * published TypeScript contract package, so these mirror the wire shapes
 * observed from `grok agent stdio` and the ACP schema reference
 * (https://agentclientprotocol.com/protocol/schema). Optional/unknown fields
 * are kept loose on purpose: Grok Build is a fast-moving beta and unknown
 * additions must not break parsing.
 */

export interface AcpAuthMethod {
  id: string
  name?: string
  description?: string
}

export interface AcpInitializeResponse {
  protocolVersion?: number
  authMethods?: AcpAuthMethod[]
  agentCapabilities?: {
    loadSession?: boolean
    [key: string]: unknown
  }
  agentInfo?: {
    name?: string
    version?: string
  }
}

export interface AcpModelInfo {
  modelId: string
  name?: string
  description?: string
  _meta?: Record<string, unknown>
}

export interface AcpSessionModelState {
  currentModelId?: string
  availableModels?: AcpModelInfo[]
}

export interface AcpSessionSetupResponse {
  sessionId?: string
  models?: AcpSessionModelState
  modes?: unknown
}

export type AcpStopReason = 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled'

export interface AcpPromptResponse {
  stopReason?: AcpStopReason | string
  _meta?: Record<string, unknown> | null
}

export interface AcpContentBlock {
  type: string
  text?: string
  [key: string]: unknown
}

export interface AcpToolCallUpdate {
  toolCallId?: string
  title?: string
  kind?: string
  status?: string
  rawInput?: unknown
  rawOutput?: unknown
  content?: unknown[]
  locations?: unknown[]
}

export interface AcpPlanEntry {
  content?: string
  priority?: string
  status?: string
}

export interface AcpSessionUpdate {
  sessionUpdate?: string
  content?: AcpContentBlock
  entries?: AcpPlanEntry[]
  [key: string]: unknown
}

export interface AcpSessionUpdateParams {
  sessionId?: string
  update?: AcpSessionUpdate
}

export interface AcpPermissionOption {
  optionId: string
  name?: string
  kind?: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' | string
}

export interface AcpRequestPermissionParams {
  sessionId?: string
  toolCall?: AcpToolCallUpdate
  options?: AcpPermissionOption[]
}

export interface AcpMcpServerEnvVariable {
  name: string
  value: string
}

export interface AcpStdioMcpServer {
  name: string
  command: string
  args: string[]
  env: AcpMcpServerEnvVariable[]
}

/** xAI private notification confirming a prompt finished (fallback channel). */
export interface XAiPromptCompleteParams {
  sessionId?: string
  promptId?: string
  stopReason?: string
  agentResult?: unknown
}

export interface XAiAskUserQuestionOption {
  label: string
  description?: string
  preview?: string
  id?: string
}

export interface XAiAskUserQuestion {
  id?: string
  question: string
  options: XAiAskUserQuestionOption[]
  multiSelect?: boolean | null
}

export interface XAiAskUserQuestionParams {
  sessionId?: string
  toolCallId?: string
  questions?: XAiAskUserQuestion[]
  mode?: string
  /** Some Grok versions wrap the payload as { method, params }. */
  method?: string
  params?: XAiAskUserQuestionParams
}

export function unwrapAskUserQuestionParams(params: XAiAskUserQuestionParams): XAiAskUserQuestionParams {
  return params.params ?? params
}
