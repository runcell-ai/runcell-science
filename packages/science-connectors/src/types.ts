import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

export type ConnectorBatch = 'P0' | 'P1' | 'P2'
export type ConnectorStatus = 'planned' | 'implemented' | 'verified'

export interface ScienceConnectorUpstream {
  name: string
  termsUrl?: string
  license?: string
  infoUrl?: string
  notes?: string
}

export interface ScienceConnectorDefinition {
  id: `bundled:${string}`
  name: string
  displayName: string
  description: string
  batch: ConnectorBatch
  transport: 'stdio'
  auth: 'none'
  command: string
  args: string[]
  upstreams: ScienceConnectorUpstream[]
  status: ConnectorStatus
  toolCount: number
}

export interface ToolSource {
  name: string
  url?: string
  retrievedAt: string
}

export interface ToolResult<T> {
  data: T
  sources: ToolSource[]
  warnings?: string[]
}

export interface ScienceConnectorModule {
  name: string
  register(server: McpServer): void
}
