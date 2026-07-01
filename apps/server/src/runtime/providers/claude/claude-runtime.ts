import {
  query,
  type Options,
  type SDKAssistantMessage,
  type SDKMessage,
  type SDKPartialAssistantMessage,
  type SDKResultMessage,
  type SDKSystemMessage
} from '@anthropic-ai/claude-agent-sdk'

import { config } from '../../../config/env'
import { agentSessionService } from '../../../services'
import type {
  CodeAgentProviderRuntime,
  RuntimeInterruptInput,
  RuntimeResolveRequestInput,
  RuntimeStartInitialTurnInput,
  RuntimeStartTurnInput
} from '../../code-agent-provider'
import { RuntimeProviderError } from '../../code-agent-provider'

interface ClaudeActiveTurn {
  sessionId: string
  turnId: string
  abortController: AbortController
  streamedAssistantChars: number
}

type StreamEventPayload = {
  type?: string
  delta?: {
    type?: string
    text?: string
    partial_json?: string
  }
  content_block?: {
    type?: string
    id?: string
    name?: string
    input?: unknown
  }
}

export class ClaudeRuntime implements CodeAgentProviderRuntime {
  private readonly activeTurns = new Map<string, ClaudeActiveTurn>()

  async startInitialTurn(input: RuntimeStartInitialTurnInput): Promise<void> {
    this.startQuery(input.session.id, input.turn.id, input.message.text, {
      cwd: input.session.cwd,
      model: input.session.model ?? config.claudeDefaultModel ?? undefined,
      title: input.session.title ?? undefined
    })
  }

  async startTurn(input: RuntimeStartTurnInput): Promise<void> {
    if (!input.session.providerSessionId) {
      throw new RuntimeProviderError(
        'provider_request_failed',
        'Claude session has no provider session id to resume.',
        409
      )
    }

    this.startQuery(input.session.id, input.turn.id, input.message.text, {
      cwd: input.session.cwd,
      model: input.session.model ?? config.claudeDefaultModel ?? undefined,
      resume: input.session.providerSessionId
    })
  }

  async resolveRequest(_input: RuntimeResolveRequestInput): Promise<void> {
    return
  }

  async interrupt(input: RuntimeInterruptInput): Promise<void> {
    const activeTurn = this.activeTurns.get(input.session.id)
    if (!activeTurn) {
      return
    }

    activeTurn.abortController.abort()
  }

  async dispose(): Promise<void> {
    for (const activeTurn of this.activeTurns.values()) {
      activeTurn.abortController.abort()
    }
    this.activeTurns.clear()
  }

  private startQuery(
    sessionId: string,
    turnId: string,
    prompt: string,
    options: Pick<Options, 'cwd' | 'model' | 'resume' | 'title'>
  ): void {
    if (this.activeTurns.has(sessionId)) {
      throw new RuntimeProviderError('provider_request_failed', 'Claude session already has an active turn.', 409)
    }

    const abortController = new AbortController()
    const activeTurn: ClaudeActiveTurn = {
      sessionId,
      turnId,
      abortController,
      streamedAssistantChars: 0
    }
    this.activeTurns.set(sessionId, activeTurn)

    void this.consumeQuery(activeTurn, prompt, options).catch((error) => {
      this.handleQueryError(activeTurn, error)
    })
  }

  private async consumeQuery(
    activeTurn: ClaudeActiveTurn,
    prompt: string,
    inputOptions: Pick<Options, 'cwd' | 'model' | 'resume' | 'title'>
  ): Promise<void> {
    const sdkOptions: Options = {
      cwd: inputOptions.cwd,
      ...(inputOptions.model ? { model: inputOptions.model } : {}),
      ...(inputOptions.resume ? { resume: inputOptions.resume } : {}),
      ...(inputOptions.title ? { title: inputOptions.title } : {}),
      abortController: activeTurn.abortController,
      includePartialMessages: true,
      pathToClaudeCodeExecutable: config.claudeCodeBinaryPath,
      permissionMode: config.claudePermissionMode,
      allowDangerouslySkipPermissions: config.claudeAllowDangerouslySkipPermissions,
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code'
      },
      env: {
        ...process.env,
        CLAUDE_AGENT_SDK_CLIENT_APP: 'open-science/0.1.0',
        ...(config.claudeConfigDir ? { CLAUDE_CONFIG_DIR: config.claudeConfigDir } : {})
      }
    }

    for await (const message of query({ prompt, options: sdkOptions })) {
      this.handleSdkMessage(activeTurn, message)
    }

    if (this.activeTurns.get(activeTurn.sessionId) === activeTurn) {
      this.handleQueryError(activeTurn, new Error('Claude query ended without a result message.'))
    }
  }

  private handleSdkMessage(activeTurn: ClaudeActiveTurn, message: SDKMessage): void {
    switch (message.type) {
      case 'system':
        if (message.subtype === 'init') {
          this.handleSystemMessage(activeTurn, message as SDKSystemMessage)
        } else {
          this.recordActivity(activeTurn, `claude.system.${message.subtype}`, message, `Claude ${message.subtype}`, 'info')
        }
        return
      case 'stream_event':
        this.handleStreamEvent(activeTurn, message)
        return
      case 'assistant':
        this.handleAssistantMessage(activeTurn, message)
        return
      case 'result':
        this.handleResultMessage(activeTurn, message)
        return
      default:
        this.recordActivity(activeTurn, `claude.${message.type}`, message, message.type, 'info')
    }
  }

  private handleSystemMessage(activeTurn: ClaudeActiveTurn, message: SDKSystemMessage): void {
    if (message.subtype === 'init') {
      agentSessionService.updateProviderBinding({
        sessionId: activeTurn.sessionId,
        providerSessionId: message.session_id,
        providerThreadId: message.session_id,
        resumeCursorJson: JSON.stringify({ sessionId: message.session_id })
      })
      agentSessionService.updateTurnProviderId({
        sessionId: activeTurn.sessionId,
        turnId: activeTurn.turnId,
        providerTurnId: message.uuid
      })
    }

    this.recordActivity(activeTurn, `claude.system.${message.subtype}`, message, `Claude ${message.subtype}`, 'info')
  }

  private handleStreamEvent(activeTurn: ClaudeActiveTurn, message: SDKPartialAssistantMessage): void {
    const textDelta = extractClaudeStreamTextDelta(message)

    if (textDelta) {
      activeTurn.streamedAssistantChars += textDelta.length
      agentSessionService.appendAssistantMessageDelta({
        sessionId: activeTurn.sessionId,
        turnId: activeTurn.turnId,
        provider: 'claude',
        delta: textDelta,
        providerItemId: assistantProviderItemId(activeTurn),
        rawSource: 'claude.agent-sdk.stream_event',
        rawJson: message,
        canonicalJson: {
          type: 'content.delta',
          streamKind: 'assistant_text',
          delta: textDelta,
          providerItemId: assistantProviderItemId(activeTurn)
        }
      })
      return
    }

    const event = message.event as StreamEventPayload

    if (event.type === 'content_block_start') {
      this.recordActivity(
        activeTurn,
        'claude.content_block_start',
        message,
        titleForContentBlock(event),
        'started',
        summaryForContentBlock(event)
      )
      return
    }

    if (event.type === 'content_block_stop') {
      this.recordActivity(activeTurn, 'claude.content_block_stop', message, 'Claude content block', 'completed')
      return
    }

    this.recordActivity(activeTurn, `claude.stream.${event.type ?? 'event'}`, message, event.type ?? 'Claude stream', 'info')
  }

  private handleAssistantMessage(activeTurn: ClaudeActiveTurn, message: SDKAssistantMessage): void {
    const fallbackText = extractAssistantText(message)
    if (activeTurn.streamedAssistantChars === 0 && fallbackText.length > 0) {
      activeTurn.streamedAssistantChars += fallbackText.length
      agentSessionService.appendAssistantMessageDelta({
        sessionId: activeTurn.sessionId,
        turnId: activeTurn.turnId,
        provider: 'claude',
        delta: fallbackText,
        providerItemId: assistantProviderItemId(activeTurn),
        rawSource: 'claude.agent-sdk.assistant',
        rawJson: message,
        canonicalJson: {
          type: 'content.delta',
          streamKind: 'assistant_text',
          delta: fallbackText,
          providerItemId: assistantProviderItemId(activeTurn)
        }
      })
    }

    this.recordActivity(activeTurn, 'claude.assistant', message, 'Claude assistant message', 'completed')
  }

  private handleResultMessage(activeTurn: ClaudeActiveTurn, message: SDKResultMessage): void {
    agentSessionService.updateProviderBinding({
      sessionId: activeTurn.sessionId,
      providerSessionId: message.session_id,
      providerThreadId: message.session_id,
      resumeCursorJson: JSON.stringify({ sessionId: message.session_id })
    })

    this.recordActivity(
      activeTurn,
      `claude.result.${message.subtype}`,
      message,
      'Claude turn result',
      message.subtype
    )

    this.activeTurns.delete(activeTurn.sessionId)

    if (message.subtype === 'success') {
      agentSessionService.completeTurn(activeTurn.sessionId, activeTurn.turnId)
      return
    }

    agentSessionService.failTurn(activeTurn.sessionId, activeTurn.turnId, errorResultText(message))
  }

  private handleQueryError(activeTurn: ClaudeActiveTurn, error: unknown): void {
    this.activeTurns.delete(activeTurn.sessionId)
    const message = error instanceof Error ? error.message : String(error)
    const detail = agentSessionService.getSessionDetail(activeTurn.sessionId)

    if (detail?.session.activatedAt) {
      agentSessionService.failTurn(activeTurn.sessionId, activeTurn.turnId, message)
    } else {
      agentSessionService.discardPendingActivationSession(activeTurn.sessionId)
    }
  }

  private recordActivity(
    activeTurn: ClaudeActiveTurn,
    eventType: string,
    rawJson: unknown,
    title: string,
    status: string,
    summary?: string
  ): void {
    agentSessionService.recordRuntimeActivity({
      sessionId: activeTurn.sessionId,
      turnId: activeTurn.turnId,
      provider: 'claude',
      eventType,
      rawSource: 'claude.agent-sdk.message',
      rawJson,
      title,
      status,
      ...(summary !== undefined ? { summary } : {})
    })
  }
}

export function claudeAssistantProviderItemId(turnId: string): string {
  return `claude:${turnId}:assistant`
}

export function extractClaudeStreamTextDelta(message: SDKPartialAssistantMessage): string | null {
  const event = message.event as StreamEventPayload
  if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
    return event.delta.text
  }

  return null
}

function assistantProviderItemId(activeTurn: ClaudeActiveTurn): string {
  return claudeAssistantProviderItemId(activeTurn.turnId)
}

function errorResultText(message: SDKResultMessage): string {
  if ('errors' in message && Array.isArray(message.errors) && message.errors.length > 0) {
    return message.errors.join('\n')
  }

  return message.subtype
}

function extractAssistantText(message: SDKAssistantMessage): string {
  const content = message.message.content
  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map((entry) => {
      if (entry && typeof entry === 'object' && 'type' in entry && entry.type === 'text' && 'text' in entry) {
        return typeof entry.text === 'string' ? entry.text : ''
      }
      return ''
    })
    .join('')
}

function titleForContentBlock(event: StreamEventPayload): string {
  const blockType = event.content_block?.type
  switch (blockType) {
    case 'tool_use':
    case 'server_tool_use':
    case 'mcp_tool_use':
      return `Claude tool: ${event.content_block?.name ?? 'unknown'}`
    case 'text':
      return 'Claude text'
    default:
      return `Claude block: ${blockType ?? 'unknown'}`
  }
}

function summaryForContentBlock(event: StreamEventPayload): string | undefined {
  if (event.content_block?.name) {
    return event.content_block.name
  }

  return event.content_block?.type
}
