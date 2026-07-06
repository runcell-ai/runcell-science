import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { wrapTool } from '../../mcp/create-server.js'
import { fetchJson, withQuery } from '../../mcp/http.js'
import { clampLimit, jsonToolResult, nowSource } from '../../mcp/output.js'
import type { ScienceConnectorModule } from '../../types.js'

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
const PRIDE = 'https://www.ebi.ac.uk/pride/ws/archive/v3'

const omicsArchivesConnector: ScienceConnectorModule = {
  name: 'omics-archives',
  register(server: McpServer) {
    server.registerTool(
      'geo_search',
      {
        title: 'Search GEO DataSets',
        description: 'Search NCBI GEO DataSets through E-utilities.',
        inputSchema: {
          query: z.string(),
          maxResults: z.number().int().positive().max(50).optional()
        }
      },
      wrapTool(async ({ query, maxResults }) => {
        const retmax = clampLimit(maxResults, 10, 50)
        const url = withQuery(`${EUTILS}/esearch.fcgi`, { db: 'gds', term: query, retmode: 'json', retmax })
        const response = await fetchJson<Record<string, unknown>>(url)
        return jsonToolResult({
          data: response,
          sources: [nowSource('NCBI ESearch GEO DataSets', url)]
        })
      })
    )

    server.registerTool(
      'geo_summary',
      {
        title: 'Summarize GEO DataSets',
        description: 'Fetch summaries for GEO DataSets ids from NCBI ESummary.',
        inputSchema: { ids: z.array(z.string()).min(1).max(20) }
      },
      wrapTool(async ({ ids }) => {
        const url = withQuery(`${EUTILS}/esummary.fcgi`, { db: 'gds', id: ids.join(','), retmode: 'json' })
        const response = await fetchJson<Record<string, unknown>>(url)
        return jsonToolResult({
          data: response,
          sources: [nowSource('NCBI ESummary GEO DataSets', url)]
        })
      })
    )

    server.registerTool(
      'pride_search_projects',
      {
        title: 'Search PRIDE projects',
        description: 'Search PRIDE Archive proteomics projects by keyword.',
        inputSchema: {
          keyword: z.string(),
          limit: z.number().int().positive().max(50).optional()
        }
      },
      wrapTool(async ({ keyword, limit }) => {
        const size = clampLimit(limit, 10, 50)
        const url = withQuery(`${PRIDE}/projects`, { keyword, page: 0, size })
        const response = await fetchJson<unknown>(url)
        return jsonToolResult({
          data: response,
          sources: [nowSource('PRIDE Archive projects API', url)]
        })
      })
    )
  }
}

export default omicsArchivesConnector
