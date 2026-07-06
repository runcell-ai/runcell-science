import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import type { ToolResult, ToolSource } from '../types.js'

export function nowSource(name: string, url?: string): ToolSource {
  return {
    name,
    ...(url ? { url } : {}),
    retrievedAt: new Date().toISOString()
  }
}

export function jsonToolResult<T>(result: ToolResult<T>): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }
    ],
    structuredContent: result as unknown as Record<string, unknown>
  }
}

export function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback
  }
  return Math.max(1, Math.min(max, Math.floor(value as number)))
}
