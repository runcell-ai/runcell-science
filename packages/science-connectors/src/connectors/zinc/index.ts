import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { wrapTool } from '../../mcp/create-server.js'
import { fetchText } from '../../mcp/http.js'
import { clampLimit, jsonToolResult, nowSource } from '../../mcp/output.js'
import type { ScienceConnectorModule } from '../../types.js'

const ZINC_FILES = 'https://files.docking.org/zinc22/'
const ZINC_MAIN = 'https://zinc.docking.org/'
const CARTBLANCHE = 'https://cartblanche22.docking.org/'

const zincConnector: ScienceConnectorModule = {
  name: 'zinc',
  register(server: McpServer) {
    server.registerTool(
      'zinc_files_index',
      {
        title: 'Read ZINC22 files index',
        description: 'Read the public ZINC22 file repository index and return a short text excerpt.',
        inputSchema: {
          maxChars: z.number().int().positive().max(4000).optional()
        }
      },
      wrapTool(async ({ maxChars }) => {
        const limit = clampLimit(maxChars, 1200, 4000)
        const text = await fetchText(ZINC_FILES, { headers: { accept: 'text/html,text/plain' } })
        return jsonToolResult({
          data: {
            url: ZINC_FILES,
            excerpt: text.replace(/\s+/g, ' ').slice(0, limit),
            notes: [
              'This is the public ZINC22 file repository. Search endpoints may require interactive access controls; this connector does not scrape or bypass them.'
            ]
          },
          sources: [nowSource('ZINC22 files index', ZINC_FILES)]
        })
      })
    )

    server.registerTool(
      'zinc_access_status',
      {
        title: 'Check ZINC access status',
        description: 'Probe official ZINC and CartBlanche entry points and report whether public programmatic search appears available.',
        inputSchema: {}
      },
      wrapTool(async () => {
        const [main, cartblanche] = await Promise.all([
          fetchText(ZINC_MAIN, { headers: { accept: 'text/html,text/plain' }, timeoutMs: 15_000 }).catch((error) =>
            error instanceof Error ? error.message : String(error)
          ),
          fetchText(CARTBLANCHE, { headers: { accept: 'text/html,text/plain' }, timeoutMs: 15_000 }).catch((error) =>
            error instanceof Error ? error.message : String(error)
          )
        ])
        return jsonToolResult({
          data: {
            zincMain: {
              url: ZINC_MAIN,
              appearsChallengeProtected: /captcha|verify you're human|challenge/i.test(main),
              excerpt: main.replace(/\s+/g, ' ').slice(0, 500)
            },
            cartblanche: {
              url: CARTBLANCHE,
              appearsReachable: !/timed out|Upstream \d+/.test(cartblanche),
              excerpt: cartblanche.replace(/\s+/g, ' ').slice(0, 500)
            },
            notes: [
              'Runcell Science does not bypass access challenges. Use file repository metadata when search endpoints are not programmatically reachable.'
            ]
          },
          sources: [nowSource('ZINC main site', ZINC_MAIN), nowSource('CartBlanche22', CARTBLANCHE)]
        })
      })
    )
  }
}

export default zincConnector
