import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { wrapTool } from '../../mcp/create-server.js'
import { fetchJson, fetchText, withQuery } from '../../mcp/http.js'
import { clampLimit, jsonToolResult, nowSource } from '../../mcp/output.js'
import type { ScienceConnectorModule } from '../../types.js'

const PUBCHEM = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug'
const OLS = 'https://www.ebi.ac.uk/ols4/api'
const KEGG = 'https://rest.kegg.jp'

function parseKeggEntry(text: string): Record<string, string | string[]> {
  const record: Record<string, string | string[]> = {}
  let currentKey = ''
  for (const line of text.split('\n')) {
    const key = line.slice(0, 12).trim()
    const value = line.slice(12).trim()
    if (key) {
      currentKey = key
      record[currentKey] = value
    } else if (currentKey && value) {
      const existing = record[currentKey]
      record[currentKey] = Array.isArray(existing) ? [...existing, value] : [existing, value]
    }
  }
  return record
}

const chemistryConnector: ScienceConnectorModule = {
  name: 'chemistry',
  register(server: McpServer) {
    server.registerTool(
      'pubchem_lookup_compound',
      {
        title: 'Lookup PubChem compound',
        description: 'Fetch a PubChem compound by name.',
        inputSchema: { name: z.string() }
      },
      wrapTool(async ({ name }) => {
        const url = `${PUBCHEM}/compound/name/${encodeURIComponent(name)}/JSON`
        const response = await fetchJson<Record<string, unknown>>(url)
        return jsonToolResult({
          data: response,
          sources: [nowSource('PubChem PUG REST compound API', url)]
        })
      })
    )

    server.registerTool(
      'chebi_search_terms',
      {
        title: 'Search ChEBI terms',
        description: 'Search ChEBI through EBI OLS.',
        inputSchema: {
          query: z.string(),
          limit: z.number().int().positive().max(50).optional()
        }
      },
      wrapTool(async ({ query, limit }) => {
        const rows = clampLimit(limit, 10, 50)
        const url = withQuery(`${OLS}/search`, { q: query, ontology: 'chebi', rows })
        const response = await fetchJson<Record<string, unknown>>(url)
        return jsonToolResult({
          data: response,
          sources: [nowSource('EBI OLS ChEBI search API', url)]
        })
      })
    )

    server.registerTool(
      'kegg_compound_get',
      {
        title: 'Get KEGG compound',
        description: 'Fetch one KEGG compound entry by compound id such as C00031.',
        inputSchema: { compoundId: z.string() }
      },
      wrapTool(async ({ compoundId }) => {
        const url = `${KEGG}/get/${encodeURIComponent(compoundId)}`
        const text = await fetchText(url, { headers: { accept: 'text/plain' } })
        return jsonToolResult({
          data: parseKeggEntry(text),
          sources: [nowSource('KEGG REST get API', url)]
        })
      })
    )
  }
}

export default chemistryConnector
