import fs from 'node:fs'
import path from 'node:path'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { wrapTool } from '../../mcp/create-server.js'
import { fetchJson } from '../../mcp/http.js'
import { jsonToolResult } from '../../mcp/output.js'
import type { ScienceConnectorModule } from '../../types.js'

const rendererKey = 'chem:ketcher'
const ketMediaType = 'application/vnd.ketcher.ket+json'

type SessionDetailResponse = {
  session: {
    id: string
    cwd: string
  }
  artifacts: Array<{
    id: string
    path: string | null
    rendererKey?: string | null
    mediaType?: string | null
  }>
}

type ArtifactResponse = {
  artifact: {
    id: string
    path: string | null
    rendererKey?: string | null
    mediaType?: string | null
  }
}

type ArtifactStateResponse = ArtifactResponse & {
  state: unknown
  updatedAt: string | null
}

type KetcherState = {
  version: 1
  ket?: string
  smiles?: string
  molfile?: string
  rxnfile?: string
  dirty: boolean
  updatedAt: string
  lastExportedAt?: string
}

type OpenSketcherInput = {
  filename?: string
  path?: string
  title?: string
  smiles?: string
  molfile?: string
  rxnfile?: string
  ket?: string
}

const inputSchema = {
  filename: z.string().optional(),
  path: z.string().optional(),
  title: z.string().optional(),
  smiles: z.string().optional(),
  molfile: z.string().optional(),
  rxnfile: z.string().optional(),
  ket: z.string().optional()
}

function apiBaseUrl(): string {
  const value = process.env.OPEN_SCIENCE_API_URL?.trim().replace(/\/$/, '')
  if (!value) {
    throw new Error('OPEN_SCIENCE_API_URL is required for ketcher-chemistry.')
  }
  return value
}

function sessionId(): string {
  const value = process.env.OPEN_SCIENCE_SESSION_ID?.trim()
  if (!value) {
    throw new Error('OPEN_SCIENCE_SESSION_ID is required for ketcher-chemistry.')
  }
  return value
}

function apiPath(route: string): string {
  return `${apiBaseUrl()}${route}`
}

async function appApiJson<T>(route: string, options: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown } = {}): Promise<T> {
  return fetchJson<T>(apiPath(route), {
    method: options.method,
    headers: {
      'content-type': 'application/json'
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  })
}

function safeRelativePath(input: { filename?: string; path?: string }): string {
  const raw = input.path?.trim() || input.filename?.trim() || 'structure'
  if (raw.includes('\0') || path.isAbsolute(raw)) {
    throw new Error('filename/path must be a relative workspace path.')
  }

  const normalized = raw.split(/[\\/]+/).filter(Boolean).join('/')
  if (!normalized || normalized.split('/').includes('..')) {
    throw new Error('filename/path must stay inside the workspace.')
  }

  return path.posix.extname(normalized) ? normalized : `${normalized}.ket`
}

function initialFormat(input: OpenSketcherInput): 'ket' | 'mol' | 'rxn' | 'smiles' {
  if (input.ket) {
    return 'ket'
  }
  if (input.molfile) {
    return 'mol'
  }
  if (input.rxnfile) {
    return 'rxn'
  }
  return 'smiles'
}

function initialState(input: OpenSketcherInput): KetcherState {
  return {
    version: 1,
    ...(input.ket ? { ket: input.ket } : {}),
    ...(input.smiles ? { smiles: input.smiles } : {}),
    ...(input.molfile ? { molfile: input.molfile } : {}),
    ...(input.rxnfile ? { rxnfile: input.rxnfile } : {}),
    dirty: Boolean(input.smiles || input.molfile || input.rxnfile),
    updatedAt: new Date().toISOString()
  }
}

function hasStructureInput(input: OpenSketcherInput): boolean {
  return Boolean(input.ket || input.smiles || input.molfile || input.rxnfile)
}

function assertKetcherState(value: unknown): KetcherState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('No live Ketcher state exists yet. Open the artifact in the Ketcher renderer before exporting.')
  }
  const record = value as Partial<KetcherState>
  if (!record.ket && !record.smiles && !record.molfile && !record.rxnfile) {
    throw new Error('The Ketcher artifact has no exported structure yet. Ask the user to open or save the artifact.')
  }
  return {
    version: 1,
    ...(record.ket ? { ket: record.ket } : {}),
    ...(record.smiles ? { smiles: record.smiles } : {}),
    ...(record.molfile ? { molfile: record.molfile } : {}),
    ...(record.rxnfile ? { rxnfile: record.rxnfile } : {}),
    dirty: record.dirty === true,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date().toISOString(),
    ...(typeof record.lastExportedAt === 'string' ? { lastExportedAt: record.lastExportedAt } : {})
  }
}

async function getSession(): Promise<SessionDetailResponse> {
  return appApiJson<SessionDetailResponse>(`/api/sessions/${encodeURIComponent(sessionId())}`)
}

async function readState(artifactId: string): Promise<ArtifactStateResponse> {
  return appApiJson<ArtifactStateResponse>(
    `/api/sessions/${encodeURIComponent(sessionId())}/artifacts/${encodeURIComponent(artifactId)}/state`
  )
}

function ensureWorkspaceFile(cwd: string, relativePath: string, content: string): void {
  const cwdReal = fs.realpathSync(cwd)
  const target = path.resolve(cwdReal, relativePath)
  const parent = path.dirname(target)
  if (!target.startsWith(`${cwdReal}${path.sep}`) && target !== cwdReal) {
    throw new Error('Artifact path must stay inside the session workspace.')
  }
  fs.mkdirSync(parent, { recursive: true })
  if (!fs.existsSync(target)) {
    fs.writeFileSync(target, content, 'utf8')
  }
}

function selectedFormats(
  state: KetcherState,
  formats: Array<'ket' | 'smiles' | 'molfile' | 'rxnfile'> | undefined
): Partial<KetcherState> {
  const keys = formats ?? ['ket', 'smiles', 'molfile']
  return Object.fromEntries(keys.map((key) => [key, state[key]]).filter(([, value]) => typeof value === 'string'))
}

const ketcherChemistryConnector: ScienceConnectorModule = {
  name: 'ketcher-chemistry',
  register(server: McpServer) {
    server.registerTool(
      'open_sketcher',
      {
        title: 'Open Ketcher sketcher',
        description: 'Create or focus an editable Ketcher chemistry artifact backed by a workspace .ket file.',
        inputSchema
      },
      wrapTool(async (input) => {
        const session = await getSession()
        const relativePath = safeRelativePath(input)
        ensureWorkspaceFile(session.session.cwd, relativePath, input.ket ?? '')

        const created = await appApiJson<ArtifactResponse>(`/api/sessions/${encodeURIComponent(sessionId())}/artifacts`, {
          method: 'POST',
          body: {
            path: relativePath,
            kind: 'custom',
            title: input.title ?? path.posix.basename(relativePath),
            rendererKey,
            mediaType: ketMediaType,
            editable: true,
            focus: true,
            ...(hasStructureInput(input) ? { initialState: initialState(input) } : {}),
            metadata: {
              format: 'ket',
              initialFormat: hasStructureInput(input) ? initialFormat(input) : null,
              title: input.title ?? null,
              source: 'tool'
            }
          }
        })

        return jsonToolResult({
          data: {
            artifactId: created.artifact.id,
            path: created.artifact.path,
            rendererKey,
            mediaType: ketMediaType,
            opened: true
          },
          sources: [{ name: 'Runcell Science artifact API', retrievedAt: new Date().toISOString() }]
        })
      })
    )

    server.registerTool(
      'get_current_structure',
      {
        title: 'Get current Ketcher structure',
        description: 'Read the live Ketcher artifact state for a previously opened sketcher.',
        inputSchema: {
          artifactId: z.string()
        }
      },
      wrapTool(async ({ artifactId }) => {
        const response = await readState(artifactId)
        const state = assertKetcherState(response.state)
        return jsonToolResult({
          data: {
            artifactId,
            path: response.artifact.path,
            state
          },
          sources: [{ name: 'Runcell Science artifact state API', retrievedAt: new Date().toISOString() }]
        })
      })
    )

    server.registerTool(
      'export_structure',
      {
        title: 'Export Ketcher structure',
        description: 'Return selected exported structure formats from the live Ketcher artifact state.',
        inputSchema: {
          artifactId: z.string(),
          formats: z.array(z.enum(['ket', 'smiles', 'molfile', 'rxnfile'])).optional()
        }
      },
      wrapTool(async ({ artifactId, formats }) => {
        const response = await readState(artifactId)
        const state = assertKetcherState(response.state)
        return jsonToolResult({
          data: {
            artifactId,
            path: response.artifact.path,
            exports: selectedFormats(state, formats),
            dirty: state.dirty,
            updatedAt: state.updatedAt
          },
          sources: [{ name: 'Runcell Science artifact state API', retrievedAt: new Date().toISOString() }]
        })
      })
    )

    server.registerTool(
      'save_structure',
      {
        title: 'Save Ketcher structure',
        description: 'Write the current live Ketcher structure back to the artifact file.',
        inputSchema: {
          artifactId: z.string()
        }
      },
      wrapTool(async ({ artifactId }) => {
        const response = await readState(artifactId)
        const state = assertKetcherState(response.state)
        const content = state.ket ?? state.molfile ?? state.rxnfile ?? state.smiles ?? ''
        const written = await appApiJson<{ bytesWritten: number }>(
          `/api/sessions/${encodeURIComponent(sessionId())}/artifacts/${encodeURIComponent(artifactId)}/file`,
          {
            method: 'PUT',
            body: { content, mediaType: ketMediaType }
          }
        )
        return jsonToolResult({
          data: {
            artifactId,
            path: response.artifact.path,
            bytesWritten: written.bytesWritten,
            saved: true
          },
          sources: [{ name: 'Runcell Science artifact file API', retrievedAt: new Date().toISOString() }]
        })
      })
    )
  }
}

export default ketcherChemistryConnector
