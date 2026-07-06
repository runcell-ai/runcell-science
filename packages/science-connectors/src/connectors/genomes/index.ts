import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { wrapTool } from '../../mcp/create-server.js'
import { fetchJson, withQuery } from '../../mcp/http.js'
import { clampLimit, jsonToolResult, nowSource } from '../../mcp/output.js'
import type { ScienceConnectorModule } from '../../types.js'

const ENSEMBL_REST = 'https://rest.ensembl.org'
const UCSC = 'https://api.genome.ucsc.edu'

const genomesConnector: ScienceConnectorModule = {
  name: 'genomes',
  register(server: McpServer) {
    server.registerTool(
      'ensembl_assembly_info',
      {
        title: 'Get Ensembl assembly info',
        description: 'Fetch Ensembl assembly metadata for a species.',
        inputSchema: { species: z.string().default('homo_sapiens') }
      },
      wrapTool(async ({ species }) => {
        const url = `${ENSEMBL_REST}/info/assembly/${encodeURIComponent(species)}?content-type=application/json`
        const response = await fetchJson<Record<string, unknown>>(url)
        return jsonToolResult({
          data: response,
          sources: [nowSource('Ensembl REST assembly API', url)]
        })
      })
    )

    server.registerTool(
      'ucsc_get_sequence',
      {
        title: 'Get UCSC genome sequence',
        description: 'Fetch DNA sequence from a UCSC genome interval.',
        inputSchema: {
          genome: z.string().default('hg38'),
          chrom: z.string(),
          start: z.number().int().nonnegative(),
          end: z.number().int().positive()
        }
      },
      wrapTool(async ({ genome, chrom, start, end }) => {
        const url = `${UCSC}/getData/sequence?genome=${encodeURIComponent(genome)};chrom=${encodeURIComponent(chrom)};start=${start};end=${end}`
        const response = await fetchJson<Record<string, unknown>>(url)
        return jsonToolResult({
          data: response,
          sources: [nowSource('UCSC sequence API', url)]
        })
      })
    )

    server.registerTool(
      'ucsc_track_region',
      {
        title: 'Get UCSC track data for region',
        description: 'Fetch a bounded UCSC track interval, for example ncbiRefSeq over hg38.',
        inputSchema: {
          genome: z.string().default('hg38'),
          track: z.string().default('ncbiRefSeq'),
          chrom: z.string(),
          start: z.number().int().nonnegative(),
          end: z.number().int().positive(),
          limit: z.number().int().positive().max(100).optional()
        }
      },
      wrapTool(async ({ genome, track, chrom, start, end, limit }) => {
        const url = `${UCSC}/getData/track?genome=${encodeURIComponent(genome)};track=${encodeURIComponent(track)};chrom=${encodeURIComponent(chrom)};start=${start};end=${end}`
        const response = await fetchJson<Record<string, unknown>>(url)
        const rowLimit = clampLimit(limit, 20, 100)
        const rows = Array.isArray(response[track]) ? (response[track] as unknown[]).slice(0, rowLimit) : response[track]
        return jsonToolResult({
          data: { ...response, [track]: rows },
          sources: [nowSource('UCSC track API', url)]
        })
      })
    )
  }
}

export default genomesConnector
