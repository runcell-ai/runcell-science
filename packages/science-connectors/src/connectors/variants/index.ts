import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { wrapTool } from '../../mcp/create-server.js'
import { fetchJson, withQuery } from '../../mcp/http.js'
import { clampLimit, jsonToolResult, nowSource } from '../../mcp/output.js'
import type { ScienceConnectorModule } from '../../types.js'

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'

const variantsConnector: ScienceConnectorModule = {
  name: 'variants',
  register(server: McpServer) {
    server.registerTool(
      'clinvar_search',
      {
        title: 'Search ClinVar',
        description: 'Search ClinVar records using NCBI E-utilities.',
        inputSchema: {
          query: z.string(),
          maxResults: z.number().int().positive().max(50).optional()
        }
      },
      wrapTool(async ({ query, maxResults }) => {
        const retmax = clampLimit(maxResults, 10, 50)
        const url = withQuery(`${EUTILS}/esearch.fcgi`, {
          db: 'clinvar',
          term: query,
          retmode: 'json',
          retmax
        })
        const response = await fetchJson<{ esearchresult?: { count?: string; idlist?: string[]; querytranslation?: string } }>(url)
        return jsonToolResult({
          data: {
            count: Number(response.esearchresult?.count ?? 0),
            ids: response.esearchresult?.idlist ?? [],
            queryTranslation: response.esearchresult?.querytranslation ?? null
          },
          sources: [nowSource('NCBI ESearch ClinVar', url)]
        })
      })
    )

    server.registerTool(
      'clinvar_summary',
      {
        title: 'Summarize ClinVar records',
        description: 'Fetch ClinVar summary records by ClinVar variation ids.',
        inputSchema: {
          ids: z.array(z.string()).min(1).max(20)
        }
      },
      wrapTool(async ({ ids }) => {
        const url = withQuery(`${EUTILS}/esummary.fcgi`, { db: 'clinvar', id: ids.join(','), retmode: 'json' })
        const response = await fetchJson<{ result?: Record<string, unknown> & { uids?: string[] } }>(url)
        const uids = response.result?.uids ?? ids
        const records = uids.map((id) => response.result?.[id]).filter(Boolean)
        return jsonToolResult({
          data: { records },
          sources: [nowSource('NCBI ESummary ClinVar', url)]
        })
      })
    )

    server.registerTool(
      'dbsnp_summary',
      {
        title: 'Summarize dbSNP rsID',
        description: 'Fetch dbSNP summary information for one or more numeric rsIDs.',
        inputSchema: {
          rsids: z.array(z.string()).min(1).max(20)
        }
      },
      wrapTool(async ({ rsids }) => {
        const cleanIds = rsids.map((id) => id.replace(/^rs/i, ''))
        const url = withQuery(`${EUTILS}/esummary.fcgi`, { db: 'snp', id: cleanIds.join(','), retmode: 'json' })
        const response = await fetchJson<{ result?: Record<string, unknown> & { uids?: string[] } }>(url)
        const uids = response.result?.uids ?? cleanIds
        const records = uids.map((id) => response.result?.[id]).filter(Boolean)
        return jsonToolResult({
          data: { records },
          sources: [nowSource('NCBI ESummary dbSNP', url)]
        })
      })
    )
  }
}

export default variantsConnector
