import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { fetchJson, fetchText, withQuery } from '../../mcp/http.js'
import { jsonToolResult, nowSource, clampLimit } from '../../mcp/output.js'
import { wrapTool } from '../../mcp/create-server.js'
import { xmlAttr, xmlElements } from '../../mcp/xml.js'
import type { ScienceConnectorModule } from '../../types.js'

const BIOMART_BASES = ['https://useast.ensembl.org/biomart/martservice', 'https://asia.ensembl.org/biomart/martservice']
const ENSEMBL_REST = 'https://rest.ensembl.org'

async function fetchBioMartText(params: Record<string, string | number | boolean | undefined>): Promise<{ url: string; text: string }> {
  let lastError: unknown
  for (const base of BIOMART_BASES) {
    const url = withQuery(base, params)
    try {
      return { url, text: await fetchText(url) }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

function rowsFromTsv(text: string, limit: number): string[][] {
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .slice(0, limit)
    .map((line) => line.split('\t'))
}

const biomartConnector: ScienceConnectorModule = {
  name: 'biomart',
  register(server: McpServer) {
    server.registerTool(
      'biomart_list_marts',
      {
        title: 'List BioMart marts',
        description: 'List available Ensembl BioMart marts from the public martservice registry.',
        inputSchema: {}
      },
      wrapTool(async () => {
        const { url, text } = await fetchBioMartText({ type: 'registry' })
        const marts = xmlElements(text, 'MartURLLocation').map((element) => ({
          name: xmlAttr(element, 'name'),
          displayName: xmlAttr(element, 'displayName'),
          database: xmlAttr(element, 'database'),
          default: xmlAttr(element, 'default') === '1'
        }))
        return jsonToolResult({
          data: { marts },
          sources: [nowSource('Ensembl BioMart registry', url)]
        })
      })
    )

    server.registerTool(
      'biomart_list_datasets',
      {
        title: 'List BioMart datasets',
        description: 'List datasets for an Ensembl BioMart mart, for example ENSEMBL_MART_ENSEMBL.',
        inputSchema: {
          mart: z.string().default('ENSEMBL_MART_ENSEMBL'),
          limit: z.number().int().positive().max(200).optional()
        }
      },
      wrapTool(async ({ mart, limit }) => {
        const rowLimit = clampLimit(limit, 40, 200)
        const { url, text } = await fetchBioMartText({ type: 'datasets', mart })
        const datasets = rowsFromTsv(text, rowLimit).map((row) => ({
          name: row[1] ?? null,
          description: row[2] ?? null,
          version: row[4] ?? null
        }))
        return jsonToolResult({
          data: { mart, datasets },
          sources: [nowSource('Ensembl BioMart datasets', url)]
        })
      })
    )

    server.registerTool(
      'biomart_query',
      {
        title: 'Run BioMart query',
        description: 'Run a bounded BioMart tabular query for one dataset with attributes and optional equality filters.',
        inputSchema: {
          dataset: z.string().default('hsapiens_gene_ensembl'),
          attributes: z.array(z.string()).min(1).max(12).default(['ensembl_gene_id', 'external_gene_name']),
          filters: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
          limit: z.number().int().positive().max(100).optional()
        }
      },
      wrapTool(async ({ dataset, attributes, filters, limit }) => {
        const rowLimit = clampLimit(limit, 20, 100)
        const filterXml = Object.entries(filters ?? {})
          .map(([name, value]) => {
            const joined = Array.isArray(value) ? value.join(',') : value
            return `<Filter name="${name}" value="${escapeXml(joined)}"/>`
          })
          .join('')
        const attrXml = attributes.map((name) => `<Attribute name="${escapeXml(name)}"/>`).join('')
        const query =
          `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE Query><Query virtualSchemaName="default" formatter="TSV" header="0" uniqueRows="1" count="" datasetConfigVersion="0.6"><Dataset name="${escapeXml(dataset)}" interface="default">${filterXml}${attrXml}</Dataset></Query>`
        const { url, text } = await fetchBioMartText({ query })
        return jsonToolResult({
          data: {
            dataset,
            attributes,
            rows: rowsFromTsv(text, rowLimit),
            truncated: rowsFromTsv(text, rowLimit + 1).length > rowLimit
          },
          sources: [nowSource('Ensembl BioMart query', url)]
        })
      })
    )

    server.registerTool(
      'ensembl_lookup_symbol',
      {
        title: 'Lookup Ensembl gene by symbol',
        description: 'Resolve a gene symbol to Ensembl gene metadata using Ensembl REST.',
        inputSchema: {
          species: z.string().default('homo_sapiens'),
          symbol: z.string()
        }
      },
      wrapTool(async ({ species, symbol }) => {
        const url = `${ENSEMBL_REST}/lookup/symbol/${encodeURIComponent(species)}/${encodeURIComponent(symbol)}?content-type=application/json`
        const record = await fetchJson<Record<string, unknown>>(url)
        return jsonToolResult({
          data: record,
          sources: [nowSource('Ensembl REST lookup/symbol', url)]
        })
      })
    )
  }
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export default biomartConnector
