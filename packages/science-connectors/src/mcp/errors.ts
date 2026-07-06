import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

export function errorToolResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error)
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            error: {
              message,
              name: error instanceof Error ? error.name : 'Error'
            }
          },
          null,
          2
        )
      }
    ]
  }
}
