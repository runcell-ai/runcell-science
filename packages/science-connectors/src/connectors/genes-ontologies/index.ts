import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { wrapTool } from '../../mcp/create-server.js'
import { fetchJson, withQuery } from '../../mcp/http.js'
import { clampLimit, jsonToolResult, nowSource } from '../../mcp/output.js'
import type { ScienceConnectorModule } from '../../types.js'

const MYGENE = 'https://mygene.info/v3'
const OLS = 'https://www.ebi.ac.uk/ols4/api'
const QUICKGO = 'https://www.ebi.ac.uk/QuickGO/services'

const genesOntologiesConnector: ScienceConnectorModule = {
  name: 'genes-ontologies',
  register(server: McpServer) {
    server.registerTool(
      'mygene_query',
      {
        title: 'Query MyGene.info',
        description: 'Search MyGene.info for gene records by symbol, name, Entrez id, Ensembl id, or free text.',
        inputSchema: {
          query: z.string(),
          species: z.string().optional().default('human'),
          fields: z.array(z.string()).max(30).optional(),
          limit: z.number().int().positive().max(50).optional()
        }
      },
      wrapTool(async ({ query, species, fields, limit }) => {
        const size = clampLimit(limit, 10, 50)
        const url = withQuery(`${MYGENE}/query`, {
          q: query,
          species,
          fields: fields?.join(',') ?? 'symbol,name,taxid,entrezgene,ensemblgene,summary',
          size
        })
        const response = await fetchJson<Record<string, unknown>>(url)
        return jsonToolResult({
          data: {
            total: response.total ?? null,
            hits: response.hits ?? []
          },
          sources: [nowSource('MyGene.info query API', url)]
        })
      })
    )

    server.registerTool(
      'ols_search_terms',
      {
        title: 'Search ontology terms',
        description: 'Search EBI OLS ontology terms, optionally within one ontology such as go, mondo, or efo.',
        inputSchema: {
          query: z.string(),
          ontology: z.string().optional(),
          limit: z.number().int().positive().max(50).optional()
        }
      },
      wrapTool(async ({ query, ontology, limit }) => {
        const rows = clampLimit(limit, 10, 50)
        const url = withQuery(`${OLS}/search`, { q: query, ontology, rows })
        const response = await fetchJson<{ response?: { numFound?: number; docs?: Array<Record<string, unknown>> } }>(url)
        return jsonToolResult({
          data: {
            total: response.response?.numFound ?? null,
            terms: (response.response?.docs ?? []).map((term) => ({
              label: term.label ?? null,
              ontology: term.ontology_name ?? null,
              shortForm: term.short_form ?? null,
              iri: term.iri ?? null,
              description: Array.isArray(term.description) ? term.description[0] ?? null : term.description ?? null
            }))
          },
          sources: [nowSource('EBI OLS search API', url)]
        })
      })
    )

    server.registerTool(
      'quickgo_annotations',
      {
        title: 'Search QuickGO annotations',
        description: 'Fetch GO annotations for a gene product id such as UniProtKB:P38398.',
        inputSchema: {
          geneProductId: z.string(),
          limit: z.number().int().positive().max(100).optional()
        }
      },
      wrapTool(async ({ geneProductId, limit }) => {
        const rowLimit = clampLimit(limit, 20, 100)
        const url = withQuery(`${QUICKGO}/annotation/search`, { geneProductId, limit: rowLimit })
        const response = await fetchJson<Record<string, unknown>>(url)
        return jsonToolResult({
          data: {
            numberOfHits: response.numberOfHits ?? null,
            annotations: response.results ?? []
          },
          sources: [nowSource('QuickGO annotation search API', url)]
        })
      })
    )
  }
}

export default genesOntologiesConnector
