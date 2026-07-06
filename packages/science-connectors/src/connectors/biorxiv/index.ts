import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { wrapTool } from '../../mcp/create-server.js'
import { fetchJson } from '../../mcp/http.js'
import { clampLimit, jsonToolResult, nowSource } from '../../mcp/output.js'
import type { ScienceConnectorModule } from '../../types.js'

type PreprintServer = 'biorxiv' | 'medrxiv'

interface BioRxivResponse {
  messages?: Array<Record<string, unknown>>
  collection?: Array<Record<string, unknown>>
}

function apiUrl(server: PreprintServer, path: string): string {
  return `https://api.biorxiv.org/details/${server}/${path}`
}

const biorxivConnector: ScienceConnectorModule = {
  name: 'biorxiv',
  register(server: McpServer) {
    server.registerTool(
      'biorxiv_preprints_by_date',
      {
        title: 'Search preprints by date',
        description: 'Fetch bioRxiv or medRxiv preprints for a date range and optionally filter by term.',
        inputSchema: {
          server: z.enum(['biorxiv', 'medrxiv']).default('biorxiv'),
          from: z.string().describe('Start date YYYY-MM-DD'),
          to: z.string().describe('End date YYYY-MM-DD'),
          term: z.string().optional(),
          cursor: z.number().int().nonnegative().optional(),
          maxResults: z.number().int().positive().max(100).optional()
        }
      },
      wrapTool(async (args) => {
        const limit = clampLimit(args.maxResults, 20, 100)
        const url = apiUrl(args.server, `${encodeURIComponent(args.from)}/${encodeURIComponent(args.to)}/${args.cursor ?? 0}`)
        const response = await fetchJson<BioRxivResponse>(url)
        const term = args.term?.toLowerCase()
        const collection = (response.collection ?? [])
          .filter((item) => {
            if (!term) return true
            return `${item.title ?? ''} ${item.abstract ?? ''} ${item.category ?? ''}`.toLowerCase().includes(term)
          })
          .slice(0, limit)
        return jsonToolResult({
          data: {
            server: args.server,
            messages: response.messages ?? [],
            preprints: collection,
            term: args.term ?? null
          },
          sources: [nowSource(`${args.server} API`, url)]
        })
      })
    )

    server.registerTool(
      'biorxiv_lookup_doi',
      {
        title: 'Lookup preprint DOI',
        description: 'Fetch bioRxiv or medRxiv metadata for one preprint DOI.',
        inputSchema: {
          server: z.enum(['biorxiv', 'medrxiv']).default('biorxiv'),
          doi: z.string()
        }
      },
      wrapTool(async ({ server, doi }) => {
        const url = apiUrl(server, `${doi}/na/json`)
        const response = await fetchJson<BioRxivResponse>(url)
        return jsonToolResult({
          data: {
            server,
            doi,
            preprints: response.collection ?? [],
            messages: response.messages ?? []
          },
          sources: [nowSource(`${server} DOI API`, url)]
        })
      })
    )
  }
}

export default biorxivConnector
