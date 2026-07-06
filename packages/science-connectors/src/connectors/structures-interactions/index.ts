import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { wrapTool } from '../../mcp/create-server.js'
import { fetchJson } from '../../mcp/http.js'
import { clampLimit, jsonToolResult, nowSource } from '../../mcp/output.js'
import type { ScienceConnectorModule } from '../../types.js'

const RCSB = 'https://data.rcsb.org/rest/v1/core'
const ALPHAFOLD = 'https://alphafold.ebi.ac.uk/api'

function summarizeRcsbEntry(entry: Record<string, unknown>) {
  const struct = entry.struct as Record<string, unknown> | undefined
  const exptl = Array.isArray(entry.exptl) ? (entry.exptl as Array<Record<string, unknown>>) : []
  const polymerEntities = Array.isArray(entry.polymer_entities) ? entry.polymer_entities : []
  return {
    pdbId: entry.rcsb_id ?? null,
    title: struct?.title ?? null,
    experimentalMethods: exptl.map((item) => item.method).filter(Boolean),
    releaseDate: (entry.rcsb_accession_info as Record<string, unknown> | undefined)?.initial_release_date ?? null,
    polymerEntityCount: polymerEntities.length,
    citation: Array.isArray(entry.citation) ? (entry.citation as unknown[]).slice(0, 3) : []
  }
}

const structuresInteractionsConnector: ScienceConnectorModule = {
  name: 'structures-interactions',
  register(server: McpServer) {
    server.registerTool(
      'rcsb_get_entry',
      {
        title: 'Get RCSB PDB entry',
        description: 'Fetch one RCSB PDB structure entry by PDB ID.',
        inputSchema: {
          pdbId: z.string()
        }
      },
      wrapTool(async ({ pdbId }) => {
        const url = `${RCSB}/entry/${encodeURIComponent(pdbId.toUpperCase())}`
        const entry = await fetchJson<Record<string, unknown>>(url)
        return jsonToolResult({
          data: summarizeRcsbEntry(entry),
          sources: [nowSource('RCSB PDB core entry API', url)]
        })
      })
    )

    server.registerTool(
      'alphafold_prediction',
      {
        title: 'Get AlphaFold prediction',
        description: 'Fetch AlphaFold DB prediction metadata for a UniProt accession.',
        inputSchema: {
          accession: z.string(),
          limit: z.number().int().positive().max(20).optional()
        }
      },
      wrapTool(async ({ accession, limit }) => {
        const rowLimit = clampLimit(limit, 3, 20)
        const url = `${ALPHAFOLD}/prediction/${encodeURIComponent(accession)}`
        const predictions = await fetchJson<Array<Record<string, unknown>>>(url)
        return jsonToolResult({
          data: {
            accession,
            predictions: predictions.slice(0, rowLimit).map((prediction) => ({
              modelEntityId: prediction.modelEntityId ?? null,
              latestVersion: prediction.latestVersion ?? null,
              modelCreatedDate: prediction.modelCreatedDate ?? null,
              globalMetricValue: prediction.globalMetricValue ?? null,
              pdbUrl: prediction.pdbUrl ?? null,
              cifUrl: prediction.cifUrl ?? null,
              paeDocUrl: prediction.paeDocUrl ?? null
            }))
          },
          sources: [nowSource('AlphaFold DB prediction API', url)]
        })
      })
    )
  }
}

export default structuresInteractionsConnector
