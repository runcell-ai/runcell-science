import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { wrapTool } from '../../mcp/create-server.js'
import { fetchJson } from '../../mcp/http.js'
import { clampLimit, jsonToolResult, nowSource } from '../../mcp/output.js'
import type { ScienceConnectorModule } from '../../types.js'

const REPORTER = 'https://api.reporter.nih.gov/v2'

const researchResourcesConnector: ScienceConnectorModule = {
  name: 'research-resources',
  register(server: McpServer) {
    server.registerTool(
      'nih_reporter_project_search',
      {
        title: 'Search NIH RePORTER projects',
        description: 'Search NIH RePORTER funded projects by text.',
        inputSchema: {
          text: z.string(),
          limit: z.number().int().positive().max(50).optional()
        }
      },
      wrapTool(async ({ text, limit }) => {
        const rowLimit = clampLimit(limit, 10, 50)
        const url = `${REPORTER}/projects/search`
        const response = await fetchJson<Record<string, unknown>>(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            criteria: {
              advanced_text_search: {
                operator: 'and',
                search_field: 'projecttitle,abstracttext',
                search_text: text
              }
            },
            limit: rowLimit
          })
        })
        return jsonToolResult({
          data: response,
          sources: [nowSource('NIH RePORTER projects search API', url)]
        })
      })
    )

    server.registerTool(
      'nih_reporter_pi_search',
      {
        title: 'Search NIH RePORTER by PI',
        description: 'Search NIH RePORTER projects by principal investigator last name.',
        inputSchema: {
          lastName: z.string(),
          limit: z.number().int().positive().max(50).optional()
        }
      },
      wrapTool(async ({ lastName, limit }) => {
        const rowLimit = clampLimit(limit, 10, 50)
        const url = `${REPORTER}/projects/search`
        const response = await fetchJson<Record<string, unknown>>(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            criteria: { pi_names: [{ first_name: '', last_name: lastName }] },
            limit: rowLimit
          })
        })
        return jsonToolResult({
          data: response,
          sources: [nowSource('NIH RePORTER PI search API', url)]
        })
      })
    )
  }
}

export default researchResourcesConnector
