import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { wrapTool } from '../../mcp/create-server.js'
import { fetchJson, withQuery } from '../../mcp/http.js'
import { clampLimit, jsonToolResult, nowSource } from '../../mcp/output.js'
import type { ScienceConnectorModule } from '../../types.js'

const CHEMBL = 'https://www.ebi.ac.uk/chembl/api/data'

const chemblConnector: ScienceConnectorModule = {
  name: 'chembl',
  register(server: McpServer) {
    server.registerTool(
      'chembl_search_molecules',
      {
        title: 'Search ChEMBL molecules',
        description: 'Search ChEMBL molecules by text query.',
        inputSchema: {
          query: z.string(),
          limit: z.number().int().positive().max(50).optional()
        }
      },
      wrapTool(async ({ query, limit }) => {
        const rowLimit = clampLimit(limit, 10, 50)
        const url = withQuery(`${CHEMBL}/molecule/search.json`, { q: query, limit: rowLimit })
        const response = await fetchJson<Record<string, unknown>>(url)
        return jsonToolResult({
          data: {
            pageMeta: response.page_meta ?? null,
            molecules: response.molecules ?? []
          },
          sources: [nowSource('ChEMBL molecule search', url)]
        })
      })
    )

    server.registerTool(
      'chembl_get_molecule',
      {
        title: 'Get ChEMBL molecule',
        description: 'Fetch one ChEMBL molecule by CHEMBL ID.',
        inputSchema: {
          moleculeChemblId: z.string()
        }
      },
      wrapTool(async ({ moleculeChemblId }) => {
        const url = `${CHEMBL}/molecule/${encodeURIComponent(moleculeChemblId)}.json`
        const molecule = await fetchJson<Record<string, unknown>>(url)
        return jsonToolResult({
          data: molecule,
          sources: [nowSource('ChEMBL molecule API', url)]
        })
      })
    )

    server.registerTool(
      'chembl_search_targets',
      {
        title: 'Search ChEMBL targets',
        description: 'Search ChEMBL targets by gene/protein text query.',
        inputSchema: {
          query: z.string(),
          limit: z.number().int().positive().max(50).optional()
        }
      },
      wrapTool(async ({ query, limit }) => {
        const rowLimit = clampLimit(limit, 10, 50)
        const url = withQuery(`${CHEMBL}/target/search.json`, { q: query, limit: rowLimit })
        const response = await fetchJson<Record<string, unknown>>(url)
        return jsonToolResult({
          data: {
            pageMeta: response.page_meta ?? null,
            targets: response.targets ?? []
          },
          sources: [nowSource('ChEMBL target search', url)]
        })
      })
    )

    server.registerTool(
      'chembl_search_activities',
      {
        title: 'Search ChEMBL activities',
        description: 'Search ChEMBL activity records by molecule and/or target CHEMBL IDs.',
        inputSchema: {
          moleculeChemblId: z.string().optional(),
          targetChemblId: z.string().optional(),
          limit: z.number().int().positive().max(50).optional()
        }
      },
      wrapTool(async ({ moleculeChemblId, targetChemblId, limit }) => {
        if (!moleculeChemblId && !targetChemblId) {
          throw new Error('Provide moleculeChemblId or targetChemblId.')
        }
        const rowLimit = clampLimit(limit, 10, 50)
        const url = withQuery(`${CHEMBL}/activity.json`, {
          molecule_chembl_id: moleculeChemblId,
          target_chembl_id: targetChemblId,
          limit: rowLimit
        })
        const response = await fetchJson<Record<string, unknown>>(url)
        return jsonToolResult({
          data: {
            pageMeta: response.page_meta ?? null,
            activities: response.activities ?? []
          },
          sources: [nowSource('ChEMBL activity API', url)]
        })
      })
    )
  }
}

export default chemblConnector
