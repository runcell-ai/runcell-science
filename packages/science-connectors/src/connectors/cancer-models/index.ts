import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { wrapTool } from '../../mcp/create-server.js'
import { fetchJson, withQuery } from '../../mcp/http.js'
import { clampLimit, jsonToolResult, nowSource } from '../../mcp/output.js'
import type { ScienceConnectorModule } from '../../types.js'

const CBIOPORTAL = 'https://www.cbioportal.org/api'

const cancerModelsConnector: ScienceConnectorModule = {
  name: 'cancer-models',
  register(server: McpServer) {
    server.registerTool(
      'cbioportal_search_studies',
      {
        title: 'Search cBioPortal studies',
        description: 'Search public cBioPortal cancer study metadata.',
        inputSchema: {
          keyword: z.string(),
          limit: z.number().int().positive().max(50).optional()
        }
      },
      wrapTool(async ({ keyword, limit }) => {
        const pageSize = clampLimit(limit, 10, 50)
        const url = withQuery(`${CBIOPORTAL}/studies`, { keyword, projection: 'SUMMARY', pageSize })
        const response = await fetchJson<unknown>(url)
        return jsonToolResult({
          data: response,
          sources: [nowSource('cBioPortal studies API', url)]
        })
      })
    )

    server.registerTool(
      'cbioportal_list_cancer_types',
      {
        title: 'List cBioPortal cancer types',
        description: 'List public cBioPortal cancer type metadata.',
        inputSchema: {
          limit: z.number().int().positive().max(100).optional()
        }
      },
      wrapTool(async ({ limit }) => {
        const pageSize = clampLimit(limit, 20, 100)
        const url = withQuery(`${CBIOPORTAL}/cancer-types`, { projection: 'SUMMARY', pageSize })
        const response = await fetchJson<unknown>(url)
        return jsonToolResult({
          data: response,
          sources: [nowSource('cBioPortal cancer types API', url)]
        })
      })
    )
  }
}

export default cancerModelsConnector
