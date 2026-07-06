import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { wrapTool } from '../../mcp/create-server.js'
import { fetchJson, withQuery } from '../../mcp/http.js'
import { clampLimit, jsonToolResult, nowSource } from '../../mcp/output.js'
import type { ScienceConnectorModule } from '../../types.js'

const OPENFDA = 'https://api.fda.gov'

const drugRegulatoryConnector: ScienceConnectorModule = {
  name: 'drug-regulatory',
  register(server: McpServer) {
    server.registerTool(
      'openfda_label_search',
      {
        title: 'Search openFDA drug labels',
        description: 'Search openFDA drug label records.',
        inputSchema: {
          search: z.string(),
          limit: z.number().int().positive().max(50).optional()
        }
      },
      wrapTool(async ({ search, limit }) => {
        const rowLimit = clampLimit(limit, 5, 50)
        const url = withQuery(`${OPENFDA}/drug/label.json`, { search, limit: rowLimit })
        const response = await fetchJson<Record<string, unknown>>(url)
        return jsonToolResult({
          data: response,
          sources: [nowSource('openFDA drug label API', url)]
        })
      })
    )

    server.registerTool(
      'openfda_drugsfda_search',
      {
        title: 'Search openFDA Drugs@FDA',
        description: 'Search openFDA Drugs@FDA approval/application records.',
        inputSchema: {
          search: z.string(),
          limit: z.number().int().positive().max(50).optional()
        }
      },
      wrapTool(async ({ search, limit }) => {
        const rowLimit = clampLimit(limit, 5, 50)
        const url = withQuery(`${OPENFDA}/drug/drugsfda.json`, { search, limit: rowLimit })
        const response = await fetchJson<Record<string, unknown>>(url)
        return jsonToolResult({
          data: response,
          sources: [nowSource('openFDA Drugs@FDA API', url)]
        })
      })
    )
  }
}

export default drugRegulatoryConnector
