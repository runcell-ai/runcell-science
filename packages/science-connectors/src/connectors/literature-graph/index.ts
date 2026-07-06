import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { wrapTool } from '../../mcp/create-server.js'
import { fetchJson, withQuery } from '../../mcp/http.js'
import { clampLimit, jsonToolResult, nowSource } from '../../mcp/output.js'
import type { ScienceConnectorModule } from '../../types.js'

const OPENALEX = 'https://api.openalex.org'
const EUROPE_PMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest'

function summarizeOpenAlexWork(work: Record<string, unknown>) {
  return {
    id: work.id ?? null,
    doi: work.doi ?? null,
    title: work.title ?? work.display_name ?? null,
    publicationYear: work.publication_year ?? null,
    citedByCount: work.cited_by_count ?? null,
    type: work.type ?? null,
    openAccess: work.open_access ?? null,
    authorships: Array.isArray(work.authorships) ? work.authorships.slice(0, 8) : []
  }
}

const literatureGraphConnector: ScienceConnectorModule = {
  name: 'literature-graph',
  register(server: McpServer) {
    server.registerTool(
      'openalex_search_works',
      {
        title: 'Search OpenAlex works',
        description: 'Search OpenAlex works and return citation-oriented metadata.',
        inputSchema: {
          query: z.string(),
          limit: z.number().int().positive().max(50).optional()
        }
      },
      wrapTool(async ({ query, limit }) => {
        const pageSize = clampLimit(limit, 10, 50)
        const url = withQuery(`${OPENALEX}/works`, { search: query, 'per-page': pageSize })
        const response = await fetchJson<{ meta?: Record<string, unknown>; results?: Array<Record<string, unknown>> }>(url)
        return jsonToolResult({
          data: {
            meta: response.meta ?? null,
            works: (response.results ?? []).map(summarizeOpenAlexWork)
          },
          sources: [nowSource('OpenAlex works search API', url)]
        })
      })
    )

    server.registerTool(
      'openalex_lookup_doi',
      {
        title: 'Lookup DOI in OpenAlex',
        description: 'Fetch one OpenAlex work by DOI.',
        inputSchema: {
          doi: z.string()
        }
      },
      wrapTool(async ({ doi }) => {
        const normalized = doi.replace(/^https?:\/\/doi\.org\//i, '').replace(/^doi:/i, '')
        const url = `${OPENALEX}/works/https://doi.org/${encodeURIComponent(normalized)}`
        const work = await fetchJson<Record<string, unknown>>(url)
        return jsonToolResult({
          data: summarizeOpenAlexWork(work),
          sources: [nowSource('OpenAlex DOI lookup API', url)]
        })
      })
    )

    server.registerTool(
      'europepmc_search',
      {
        title: 'Search Europe PMC',
        description: 'Search Europe PMC literature records with a query string.',
        inputSchema: {
          query: z.string(),
          limit: z.number().int().positive().max(50).optional()
        }
      },
      wrapTool(async ({ query, limit }) => {
        const pageSize = clampLimit(limit, 10, 50)
        const url = withQuery(`${EUROPE_PMC}/search`, {
          query,
          format: 'json',
          pageSize,
          resultType: 'lite'
        })
        const response = await fetchJson<Record<string, unknown>>(url)
        return jsonToolResult({
          data: {
            hitCount: response.hitCount ?? null,
            results: (response.resultList as { result?: unknown[] } | undefined)?.result ?? []
          },
          sources: [nowSource('Europe PMC search API', url)]
        })
      })
    )
  }
}

export default literatureGraphConnector
