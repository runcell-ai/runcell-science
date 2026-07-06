import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { wrapTool } from '../../mcp/create-server.js'
import { fetchJson, fetchText, withQuery } from '../../mcp/http.js'
import { clampLimit, jsonToolResult, nowSource } from '../../mcp/output.js'
import { xmlText, xmlTexts } from '../../mcp/xml.js'
import type { ScienceConnectorModule } from '../../types.js'

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'

interface ESearchResponse {
  esearchresult: {
    count: string
    idlist: string[]
    querytranslation?: string
  }
}

interface ESummaryResponse {
  result: Record<string, unknown> & { uids?: string[] }
}

const pubmedConnector: ScienceConnectorModule = {
  name: 'pubmed',
  register(server: McpServer) {
    server.registerTool(
      'pubmed_search',
      {
        title: 'Search PubMed',
        description: 'Search PubMed with NCBI E-utilities and return PMIDs.',
        inputSchema: {
          query: z.string(),
          maxResults: z.number().int().positive().max(50).optional(),
          sort: z.enum(['relevance', 'pub_date']).optional()
        }
      },
      wrapTool(async ({ query, maxResults, sort }) => {
        const limit = clampLimit(maxResults, 10, 50)
        const url = withQuery(`${EUTILS}/esearch.fcgi`, {
          db: 'pubmed',
          term: query,
          retmode: 'json',
          retmax: limit,
          sort
        })
        const response = await fetchJson<ESearchResponse>(url)
        return jsonToolResult({
          data: {
            query,
            count: Number(response.esearchresult.count),
            pmids: response.esearchresult.idlist,
            queryTranslation: response.esearchresult.querytranslation ?? null
          },
          sources: [nowSource('NCBI ESearch PubMed', url)]
        })
      })
    )

    server.registerTool(
      'pubmed_fetch',
      {
        title: 'Fetch PubMed articles',
        description: 'Fetch PubMed article summaries and abstracts for up to 20 PMIDs.',
        inputSchema: {
          pmids: z.array(z.string()).min(1).max(20)
        }
      },
      wrapTool(async ({ pmids }) => {
        const ids = pmids.join(',')
        const summaryUrl = withQuery(`${EUTILS}/esummary.fcgi`, { db: 'pubmed', id: ids, retmode: 'json' })
        const fetchUrl = withQuery(`${EUTILS}/efetch.fcgi`, { db: 'pubmed', id: ids, retmode: 'xml' })
        const [summary, xml] = await Promise.all([
          fetchJson<ESummaryResponse>(summaryUrl),
          fetchText(fetchUrl, { headers: { accept: 'application/xml' } })
        ])
        const articles = (summary.result.uids ?? pmids).map((pmid) => {
          const item = summary.result[pmid] as Record<string, unknown> | undefined
          return {
            pmid,
            title: item?.title ?? xmlText(xml, 'ArticleTitle'),
            journal: item?.source ?? null,
            pubdate: item?.pubdate ?? null,
            doi: Array.isArray(item?.articleids)
              ? ((item.articleids as Array<{ idtype?: string; value?: string }>).find((id) => id.idtype === 'doi')?.value ?? null)
              : null,
            authors: Array.isArray(item?.authors)
              ? (item.authors as Array<{ name?: string }>).slice(0, 12).map((author) => author.name).filter(Boolean)
              : [],
            abstract: xmlTexts(xml, 'AbstractText').join('\n')
          }
        })
        return jsonToolResult({
          data: { articles },
          sources: [nowSource('NCBI ESummary PubMed', summaryUrl), nowSource('NCBI EFetch PubMed', fetchUrl)]
        })
      })
    )

    server.registerTool(
      'pubmed_related',
      {
        title: 'Find related PubMed articles',
        description: 'Find PubMed articles related to a PMID using NCBI ELink.',
        inputSchema: {
          pmid: z.string(),
          maxResults: z.number().int().positive().max(50).optional()
        }
      },
      wrapTool(async ({ pmid, maxResults }) => {
        const limit = clampLimit(maxResults, 10, 50)
        const url = withQuery(`${EUTILS}/elink.fcgi`, {
          dbfrom: 'pubmed',
          db: 'pubmed',
          id: pmid,
          cmd: 'neighbor_score',
          retmode: 'json'
        })
        const response = await fetchJson<{ linksets?: Array<{ linksetdbs?: Array<{ links?: Array<{ id: string; score?: number }> }> }> }>(url)
        const links = response.linksets?.[0]?.linksetdbs?.[0]?.links?.slice(0, limit) ?? []
        return jsonToolResult({
          data: {
            pmid,
            related: links.map((link) => ({ pmid: link.id, score: link.score ?? null }))
          },
          sources: [nowSource('NCBI ELink PubMed', url)]
        })
      })
    )
  }
}

export default pubmedConnector
