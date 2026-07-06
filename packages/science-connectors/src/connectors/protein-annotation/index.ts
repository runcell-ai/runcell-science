import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { wrapTool } from '../../mcp/create-server.js'
import { fetchJson, withQuery } from '../../mcp/http.js'
import { clampLimit, jsonToolResult, nowSource } from '../../mcp/output.js'
import type { ScienceConnectorModule } from '../../types.js'

const UNIPROT = 'https://rest.uniprot.org/uniprotkb'
const INTERPRO = 'https://www.ebi.ac.uk/interpro/api'

function summarizeUniProt(entry: Record<string, unknown>) {
  const organism = entry.organism as Record<string, unknown> | undefined
  const proteinDescription = entry.proteinDescription as Record<string, unknown> | undefined
  const recommendedName = proteinDescription?.recommendedName as Record<string, unknown> | undefined
  const fullName = recommendedName?.fullName as Record<string, unknown> | undefined
  return {
    accession: entry.primaryAccession ?? null,
    id: entry.uniProtkbId ?? null,
    entryType: entry.entryType ?? null,
    proteinName: fullName?.value ?? null,
    organism: organism?.scientificName ?? null,
    taxonId: organism?.taxonId ?? null,
    genes: entry.genes ?? [],
    comments: Array.isArray(entry.comments) ? entry.comments.slice(0, 8) : []
  }
}

const proteinAnnotationConnector: ScienceConnectorModule = {
  name: 'protein-annotation',
  register(server: McpServer) {
    server.registerTool(
      'uniprot_search',
      {
        title: 'Search UniProtKB',
        description: 'Search UniProtKB protein records with a UniProt query string.',
        inputSchema: {
          query: z.string(),
          limit: z.number().int().positive().max(50).optional()
        }
      },
      wrapTool(async ({ query, limit }) => {
        const size = clampLimit(limit, 10, 50)
        const url = withQuery(`${UNIPROT}/search`, { query, format: 'json', size })
        const response = await fetchJson<{ results?: Array<Record<string, unknown>> }>(url)
        return jsonToolResult({
          data: {
            proteins: (response.results ?? []).map(summarizeUniProt)
          },
          sources: [nowSource('UniProtKB search API', url)]
        })
      })
    )

    server.registerTool(
      'uniprot_get_entry',
      {
        title: 'Get UniProtKB entry',
        description: 'Fetch one UniProtKB entry by accession and return core annotation fields.',
        inputSchema: {
          accession: z.string()
        }
      },
      wrapTool(async ({ accession }) => {
        const url = `${UNIPROT}/${encodeURIComponent(accession)}.json`
        const entry = await fetchJson<Record<string, unknown>>(url)
        return jsonToolResult({
          data: summarizeUniProt(entry),
          sources: [nowSource('UniProtKB entry API', url)]
        })
      })
    )

    server.registerTool(
      'interpro_protein_entries',
      {
        title: 'Get InterPro entries for protein',
        description: 'Fetch InterPro domain/family entries mapped to a UniProt accession.',
        inputSchema: {
          accession: z.string(),
          limit: z.number().int().positive().max(50).optional()
        }
      },
      wrapTool(async ({ accession, limit }) => {
        const pageSize = clampLimit(limit, 10, 50)
        const url = `${INTERPRO}/protein/uniprot/${encodeURIComponent(accession)}/entry/interpro/?page_size=${pageSize}`
        const response = await fetchJson<Record<string, unknown>>(url)
        return jsonToolResult({
          data: {
            count: response.count ?? null,
            entries: response.results ?? []
          },
          sources: [nowSource('InterPro protein entries API', url)]
        })
      })
    )
  }
}

export default proteinAnnotationConnector
