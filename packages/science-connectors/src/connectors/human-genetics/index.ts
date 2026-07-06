import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { wrapTool } from '../../mcp/create-server.js'
import { fetchJson, withQuery } from '../../mcp/http.js'
import { clampLimit, jsonToolResult, nowSource } from '../../mcp/output.js'
import type { ScienceConnectorModule } from '../../types.js'

const GWAS = 'https://www.ebi.ac.uk/gwas/rest/api'
const GWAS_SUMMARY = 'https://www.ebi.ac.uk/gwas/summary-statistics/api'

const humanGeneticsConnector: ScienceConnectorModule = {
  name: 'human-genetics',
  register(server: McpServer) {
    server.registerTool(
      'gwas_trait_studies',
      {
        title: 'Search GWAS studies by trait',
        description: 'Search GWAS Catalog studies by EFO trait label.',
        inputSchema: {
          efoTrait: z.string(),
          limit: z.number().int().positive().max(50).optional()
        }
      },
      wrapTool(async ({ efoTrait, limit }) => {
        const size = clampLimit(limit, 10, 50)
        const url = withQuery(`${GWAS}/studies/search/findByEfoTrait`, { efoTrait, page: 0, size })
        const response = await fetchJson<Record<string, unknown>>(url, { timeoutMs: 45_000 })
        return jsonToolResult({
          data: response,
          sources: [nowSource('GWAS Catalog studies by trait API', url)]
        })
      })
    )

    server.registerTool(
      'gwas_variant_associations',
      {
        title: 'Search GWAS associations by rsID',
        description: 'Fetch GWAS Catalog summary-statistics association metadata by rsID.',
        inputSchema: {
          rsId: z.string(),
          limit: z.number().int().positive().max(50).optional()
        }
      },
      wrapTool(async ({ rsId, limit }) => {
        const size = clampLimit(limit, 10, 50)
        const url = withQuery(`${GWAS_SUMMARY}/associations/${encodeURIComponent(rsId)}`, { size })
        const response = await fetchJson<Record<string, unknown>>(url, { timeoutMs: 20_000 })
        return jsonToolResult({
          data: response,
          sources: [nowSource('GWAS Catalog summary-statistics association API', url)]
        })
      })
    )
  }
}

export default humanGeneticsConnector
