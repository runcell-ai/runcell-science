import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { wrapTool } from '../../mcp/create-server.js'
import { fetchJson, withQuery } from '../../mcp/http.js'
import { clampLimit, jsonToolResult, nowSource } from '../../mcp/output.js'
import type { ScienceConnectorModule } from '../../types.js'

const RNACENTRAL = 'https://rnacentral.org/api/v1'

const rnaConnector: ScienceConnectorModule = {
  name: 'rna',
  register(server: McpServer) {
    server.registerTool(
      'rnacentral_search',
      {
        title: 'Search RNAcentral',
        description: 'Search RNAcentral non-coding RNA entries.',
        inputSchema: {
          query: z.string(),
          limit: z.number().int().positive().max(50).optional()
        }
      },
      wrapTool(async ({ query, limit }) => {
        const pageSize = clampLimit(limit, 10, 50)
        const url = withQuery(`${RNACENTRAL}/rna/`, { q: query, page_size: pageSize, format: 'json' })
        const response = await fetchJson<Record<string, unknown>>(url)
        return jsonToolResult({
          data: response,
          sources: [nowSource('RNAcentral RNA search API', url)]
        })
      })
    )

    server.registerTool(
      'rnacentral_get_entry',
      {
        title: 'Get RNAcentral entry',
        description: 'Fetch one RNAcentral entry by URS id and optional taxid.',
        inputSchema: {
          ursId: z.string(),
          taxid: z.string().optional()
        }
      },
      wrapTool(async ({ ursId, taxid }) => {
        const path = taxid ? `${ursId}/${taxid}/` : `${ursId}/`
        const url = `${RNACENTRAL}/rna/${encodeURI(path)}?format=json`
        const response = await fetchJson<Record<string, unknown>>(url)
        return jsonToolResult({
          data: response,
          sources: [nowSource('RNAcentral RNA entry API', url)]
        })
      })
    )
  }
}

export default rnaConnector
