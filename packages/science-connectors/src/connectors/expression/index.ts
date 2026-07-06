import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { wrapTool } from '../../mcp/create-server.js'
import { fetchJson, withQuery } from '../../mcp/http.js'
import { clampLimit, jsonToolResult, nowSource } from '../../mcp/output.js'
import type { ScienceConnectorModule } from '../../types.js'

const GTEX = 'https://gtexportal.org/api/v2'

const expressionConnector: ScienceConnectorModule = {
  name: 'expression',
  register(server: McpServer) {
    server.registerTool(
      'gtex_gene_search',
      {
        title: 'Search GTEx genes',
        description: 'Search GTEx gene reference records by gene symbol or Ensembl id.',
        inputSchema: { geneId: z.string() }
      },
      wrapTool(async ({ geneId }) => {
        const url = withQuery(`${GTEX}/reference/geneSearch`, { geneId })
        const response = await fetchJson<Record<string, unknown>>(url)
        return jsonToolResult({
          data: response,
          sources: [nowSource('GTEx reference geneSearch API', url)]
        })
      })
    )

    server.registerTool(
      'gtex_median_gene_expression',
      {
        title: 'Get GTEx median gene expression',
        description: 'Fetch GTEx median gene expression by versioned GENCODE id and optional tissue.',
        inputSchema: {
          gencodeId: z.string(),
          tissueSiteDetailId: z.string().optional(),
          datasetId: z.enum(['gtex_v8', 'gtex_v10', 'gtex_snrnaseq_pilot']).default('gtex_v8'),
          limit: z.number().int().positive().max(100).optional()
        }
      },
      wrapTool(async ({ gencodeId, tissueSiteDetailId, datasetId, limit }) => {
        const itemsPerPage = clampLimit(limit, 20, 100)
        const url = withQuery(`${GTEX}/expression/medianGeneExpression`, {
          gencodeId,
          tissueSiteDetailId,
          datasetId,
          itemsPerPage
        })
        const response = await fetchJson<Record<string, unknown>>(url)
        return jsonToolResult({
          data: response,
          sources: [nowSource('GTEx medianGeneExpression API', url)]
        })
      })
    )
  }
}

export default expressionConnector
