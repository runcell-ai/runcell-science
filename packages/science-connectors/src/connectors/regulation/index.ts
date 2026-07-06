import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { wrapTool } from '../../mcp/create-server.js'
import { fetchJson, withQuery } from '../../mcp/http.js'
import { clampLimit, jsonToolResult, nowSource } from '../../mcp/output.js'
import type { ScienceConnectorModule } from '../../types.js'

const ENCODE = 'https://www.encodeproject.org'
const JASPAR = 'https://jaspar.elixir.no/api/v1'

const regulationConnector: ScienceConnectorModule = {
  name: 'regulation',
  register(server: McpServer) {
    server.registerTool(
      'encode_search_experiments',
      {
        title: 'Search ENCODE experiments',
        description: 'Search ENCODE experiment metadata by term.',
        inputSchema: {
          searchTerm: z.string(),
          assayTitle: z.string().optional(),
          limit: z.number().int().positive().max(50).optional()
        }
      },
      wrapTool(async ({ searchTerm, assayTitle, limit }) => {
        const rowLimit = clampLimit(limit, 10, 50)
        const url = withQuery(`${ENCODE}/search/`, {
          type: 'Experiment',
          searchTerm,
          assay_title: assayTitle,
          limit: rowLimit,
          format: 'json'
        })
        const response = await fetchJson<Record<string, unknown>>(url)
        return jsonToolResult({
          data: {
            total: response.total ?? null,
            graph: Array.isArray(response['@graph']) ? (response['@graph'] as unknown[]).slice(0, rowLimit) : []
          },
          sources: [nowSource('ENCODE search API', url)]
        })
      })
    )

    server.registerTool(
      'jaspar_search_motifs',
      {
        title: 'Search JASPAR motifs',
        description: 'Search JASPAR transcription factor binding profiles.',
        inputSchema: {
          query: z.string(),
          limit: z.number().int().positive().max(50).optional()
        }
      },
      wrapTool(async ({ query, limit }) => {
        const pageSize = clampLimit(limit, 10, 50)
        const url = withQuery(`${JASPAR}/matrix/`, { search: query, page_size: pageSize })
        const response = await fetchJson<Record<string, unknown>>(url)
        return jsonToolResult({
          data: response,
          sources: [nowSource('JASPAR matrix API', url)]
        })
      })
    )
  }
}

export default regulationConnector
