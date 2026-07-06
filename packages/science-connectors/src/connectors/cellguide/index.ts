import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { wrapTool } from '../../mcp/create-server.js'
import { fetchJson, withQuery } from '../../mcp/http.js'
import { clampLimit, jsonToolResult, nowSource } from '../../mcp/output.js'
import type { ScienceConnectorModule } from '../../types.js'

const OLS = 'https://www.ebi.ac.uk/ols4/api'
const CELLXGENE = 'https://api.cellxgene.cziscience.com'

const cellguideConnector: ScienceConnectorModule = {
  name: 'cellguide',
  register(server: McpServer) {
    server.registerTool(
      'cell_ontology_search',
      {
        title: 'Search Cell Ontology terms',
        description: 'Search Cell Ontology terms through EBI OLS.',
        inputSchema: {
          query: z.string(),
          limit: z.number().int().positive().max(50).optional()
        }
      },
      wrapTool(async ({ query, limit }) => {
        const rows = clampLimit(limit, 10, 50)
        const url = withQuery(`${OLS}/search`, { q: query, ontology: 'cl', rows })
        const response = await fetchJson<Record<string, unknown>>(url)
        return jsonToolResult({
          data: response,
          sources: [nowSource('EBI OLS Cell Ontology search API', url)]
        })
      })
    )

    server.registerTool(
      'cellxgene_public_collections',
      {
        title: 'List CELLxGENE public collections',
        description: 'Fetch CELLxGENE public collection metadata for cell atlas context.',
        inputSchema: {
          limit: z.number().int().positive().max(20).optional()
        }
      },
      wrapTool(async ({ limit }) => {
        const rowLimit = clampLimit(limit, 5, 20)
        const url = withQuery(`${CELLXGENE}/curation/v1/collections`, { visibility: 'PUBLIC', limit: rowLimit })
        const response = await fetchJson<unknown>(url)
        return jsonToolResult({
          data: response,
          sources: [nowSource('CELLxGENE public collections API', url)]
        })
      })
    )
  }
}

export default cellguideConnector
