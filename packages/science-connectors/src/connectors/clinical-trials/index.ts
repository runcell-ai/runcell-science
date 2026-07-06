import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { wrapTool } from '../../mcp/create-server.js'
import { fetchJson, withQuery } from '../../mcp/http.js'
import { clampLimit, jsonToolResult, nowSource } from '../../mcp/output.js'
import type { ScienceConnectorModule } from '../../types.js'

const CTGOV = 'https://clinicaltrials.gov/api/v2'

function summarizeStudy(study: Record<string, unknown>) {
  const protocol = study.protocolSection as Record<string, unknown> | undefined
  const id = protocol?.identificationModule as Record<string, unknown> | undefined
  const status = protocol?.statusModule as Record<string, unknown> | undefined
  const design = protocol?.designModule as Record<string, unknown> | undefined
  const conditions = protocol?.conditionsModule as Record<string, unknown> | undefined
  const sponsor = protocol?.sponsorCollaboratorsModule as Record<string, unknown> | undefined
  return {
    nctId: id?.nctId ?? null,
    briefTitle: id?.briefTitle ?? null,
    officialTitle: id?.officialTitle ?? null,
    overallStatus: status?.overallStatus ?? null,
    phases: design?.phases ?? [],
    studyType: design?.studyType ?? null,
    conditions: conditions?.conditions ?? [],
    sponsor: (sponsor?.leadSponsor as Record<string, unknown> | undefined)?.name ?? null
  }
}

const clinicalTrialsConnector: ScienceConnectorModule = {
  name: 'clinical-trials',
  register(server: McpServer) {
    server.registerTool(
      'clinical_trials_search',
      {
        title: 'Search ClinicalTrials.gov',
        description: 'Search ClinicalTrials.gov v2 studies by term, condition, intervention, or location.',
        inputSchema: {
          term: z.string().optional(),
          condition: z.string().optional(),
          intervention: z.string().optional(),
          location: z.string().optional(),
          status: z.string().optional(),
          pageSize: z.number().int().positive().max(50).optional()
        }
      },
      wrapTool(async (args) => {
        const pageSize = clampLimit(args.pageSize, 10, 50)
        const url = withQuery(`${CTGOV}/studies`, {
          format: 'json',
          pageSize,
          'query.term': args.term,
          'query.cond': args.condition,
          'query.intr': args.intervention,
          'query.locn': args.location,
          'filter.overallStatus': args.status
        })
        const response = await fetchJson<{ studies?: Array<Record<string, unknown>>; nextPageToken?: string }>(url)
        return jsonToolResult({
          data: {
            studies: (response.studies ?? []).map(summarizeStudy),
            nextPageToken: response.nextPageToken ?? null
          },
          sources: [nowSource('ClinicalTrials.gov studies API', url)]
        })
      })
    )

    server.registerTool(
      'clinical_trials_get_study',
      {
        title: 'Get ClinicalTrials.gov study',
        description: 'Fetch detailed ClinicalTrials.gov v2 study JSON by NCT ID.',
        inputSchema: {
          nctId: z.string()
        }
      },
      wrapTool(async ({ nctId }) => {
        const url = `${CTGOV}/studies/${encodeURIComponent(nctId)}?format=json`
        const study = await fetchJson<Record<string, unknown>>(url)
        return jsonToolResult({
          data: {
            summary: summarizeStudy(study),
            study
          },
          sources: [nowSource('ClinicalTrials.gov study API', url)]
        })
      })
    )
  }
}

export default clinicalTrialsConnector
