import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import { errorToolResult } from './errors.js'
import type { ScienceConnectorModule } from '../types.js'

export function createScienceMcpServer(connector: ScienceConnectorModule): McpServer {
  const server = new McpServer({
    name: `open-science-${connector.name}`,
    title: `Open Science ${connector.name}`,
    version: '0.1.0'
  })
  connector.register(server)
  return server
}

export function wrapTool<Args>(handler: (args: Args) => Promise<CallToolResult>) {
  return async (args: Args) => {
    try {
      return await handler(args)
    } catch (error) {
      return errorToolResult(error)
    }
  }
}

export async function runStdioServer(connector: ScienceConnectorModule): Promise<void> {
  const server = createScienceMcpServer(connector)
  await server.connect(new StdioServerTransport())
}
