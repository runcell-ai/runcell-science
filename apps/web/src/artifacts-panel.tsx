import { Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import {
  ArrowLeft,
  ChevronRight,
  ExternalLink,
  File as FileIcon,
  FileCode,
  FileText,
  Folder,
  FolderOpen,
  Globe2,
  Image as ImageIcon,
  Loader2,
  NotebookText,
  Plus,
  RefreshCw,
  Search,
  Sheet as SheetIcon,
  X
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type {
  AgentArtifact,
  AgentArtifactFileResponse,
  AgentArtifactMarkdownContentResponse,
  AgentArtifactStateResponse,
  ListWorkspaceFilesResponse,
  WorkspaceFile,
  WorkspaceFileKind
} from '@runcell-science/contracts'
import { Button, Input, ScrollArea } from '@runcell-science/ui'
import { CodePreview } from './code-preview'
import {
  builtinRendererKeys,
  registerArtifactRenderer,
  resolveArtifactRenderer,
  type ArtifactRendererProps
} from './lib/artifact-renderers'
const KetcherArtifactRenderer = lazy(() =>
  import('./artifact-renderers/ketcher-artifact-renderer').then((module) => ({
    default: module.KetcherArtifactRenderer
  }))
)

const NotebookViewer = lazy(() => import('./notebook/notebook-viewer'))

type ArtifactsPanelProps = {
  apiBaseUrl: string
  sessionId: string
  artifacts: AgentArtifact[]
  activeArtifactId: string | null
  draft: string
  creating: boolean
  /** Whether an agent turn is currently running; previews reload when it ends. */
  running: boolean
  /** Set when an agent executes a notebook; the panel focuses that file. */
  focusFile: { path: string; nonce: number } | null
  onDraftChange: (value: string) => void
  onCreate: (value: string) => void
  onSelectArtifact: (id: string | null) => void
  onClose: () => void
}

type Scope = 'artifacts' | 'workspace'

type WorkspaceState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; files: WorkspaceFile[]; truncated: boolean }
  | { status: 'error'; message: string }

type TextState =
  | { status: 'loading' }
  | { status: 'ready'; content: string }
  | { status: 'error'; message: string }

type PreviewModel = {
  key: string
  title: string
  subtitle: string
  icon: ReactNode
  /** 'artifact' resolves a component from the artifact renderer registry;
   * the other values are the workspace-file preview modes. */
  render: 'artifact' | 'image' | 'markdown' | 'text' | 'notebook' | 'embed' | 'none'
  src: string | null
  external: string | null
  artifact?: AgentArtifact
  filePath?: string
  fetchText?: () => Promise<string>
}

const dataExtensions = new Set(['csv', 'tsv', 'json', 'jsonl', 'ndjson', 'parquet', 'xlsx'])

function baseName(value: string): string {
  const parts = value.split('/')
  return parts[parts.length - 1] || value
}

function extensionOf(value: string): string {
  const name = baseName(value)
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`
  }
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = size / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const diffMs = Date.now() - date.getTime()
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) {
    return 'just now'
  }
  if (minutes < 60) {
    return `${minutes}m ago`
  }
  const hours = Math.round(minutes / 60)
  if (hours < 24) {
    return `${hours}h ago`
  }
  const days = Math.round(hours / 24)
  if (days < 7) {
    return `${days}d ago`
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

type WorkspaceTreeDir = {
  name: string
  path: string
  dirs: WorkspaceTreeDir[]
  files: WorkspaceFile[]
}

function buildWorkspaceTree(files: WorkspaceFile[]): WorkspaceTreeDir {
  const root: WorkspaceTreeDir = { name: '', path: '', dirs: [], files: [] }
  const dirIndex = new Map<string, WorkspaceTreeDir>([['', root]])

  for (const file of files) {
    const segments = file.path.split('/')
    let parent = root
    let prefix = ''
    for (let i = 0; i < segments.length - 1; i += 1) {
      prefix = prefix ? `${prefix}/${segments[i]}` : segments[i]
      let dir = dirIndex.get(prefix)
      if (!dir) {
        dir = { name: segments[i], path: prefix, dirs: [], files: [] }
        dirIndex.set(prefix, dir)
        parent.dirs.push(dir)
      }
      parent = dir
    }
    parent.files.push(file)
  }

  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  const sortDir = (dir: WorkspaceTreeDir) => {
    dir.dirs.sort(byName)
    dir.files.sort(byName)
    dir.dirs.forEach(sortDir)
  }
  sortDir(root)
  return root
}

type WorkspaceTreeLevelProps = {
  dir: WorkspaceTreeDir
  depth: number
  expandedDirs: Set<string>
  forceExpand: boolean
  onToggleDir: (path: string) => void
  onSelectFile: (file: WorkspaceFile) => void
}

function WorkspaceTreeLevel({ dir, depth, expandedDirs, forceExpand, onToggleDir, onSelectFile }: WorkspaceTreeLevelProps) {
  const indent = { '--tree-depth': depth } as CSSProperties
  return (
    <>
      {dir.dirs.map((child) => {
        const open = forceExpand || expandedDirs.has(child.path)
        return (
          <Fragment key={child.path}>
            <button
              type="button"
              className="tree-row tree-dir"
              style={indent}
              aria-expanded={open}
              title={child.path}
              onClick={() => onToggleDir(child.path)}
            >
              <ChevronRight className={`tree-chevron ${open ? 'is-open' : ''}`} />
              <span className="tree-icon">{open ? <FolderOpen /> : <Folder />}</span>
              <span className="tree-name">{child.name}</span>
            </button>
            {open ? (
              <WorkspaceTreeLevel
                dir={child}
                depth={depth + 1}
                expandedDirs={expandedDirs}
                forceExpand={forceExpand}
                onToggleDir={onToggleDir}
                onSelectFile={onSelectFile}
              />
            ) : null}
          </Fragment>
        )
      })}
      {dir.files.map((file) => (
        <button
          key={file.path}
          type="button"
          className="tree-row tree-file"
          style={indent}
          title={file.path}
          onClick={() => onSelectFile(file)}
        >
          <span className="tree-chevron-spacer" />
          <span className="tree-icon">{iconForFileName(file.name, file.kind)}</span>
          <span className="tree-name">{file.name}</span>
          <span className="tree-meta">
            {formatBytes(file.size)}
            <span className="tree-time">{formatWhen(file.modifiedAt)}</span>
          </span>
        </button>
      ))}
    </>
  )
}

function iconForFileName(name: string, kind: WorkspaceFileKind | 'url'): ReactNode {
  if (kind === 'url') {
    return <Globe2 />
  }
  if (kind === 'image') {
    return <ImageIcon />
  }
  if (kind === 'html') {
    return <FileCode />
  }
  if (kind === 'notebook') {
    return <NotebookText />
  }
  if (dataExtensions.has(extensionOf(name))) {
    return <SheetIcon />
  }
  if (kind === 'text' || kind === 'markdown' || kind === 'pdf') {
    return <FileText />
  }
  return <FileIcon />
}

function artifactKindTag(artifact: AgentArtifact): WorkspaceFileKind | 'url' {
  if (artifact.kind === 'url') {
    return 'url'
  }
  if (artifact.kind === 'pdf' || artifact.kind === 'markdown' || artifact.kind === 'html' || artifact.kind === 'image') {
    return artifact.kind
  }
  return 'text'
}

function artifactAssetUrl(apiBaseUrl: string, id: string): string {
  return `${apiBaseUrl}/api/artifacts/${encodeURIComponent(id)}/asset/`
}

function fileRawUrl(apiBaseUrl: string, sessionId: string, filePath: string): string {
  return `${apiBaseUrl}/api/sessions/${encodeURIComponent(sessionId)}/files/raw?path=${encodeURIComponent(filePath)}`
}

async function readError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null)
  if (body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object') {
    return String((body.error as { message?: unknown }).message ?? response.statusText)
  }
  return response.statusText
}

/** Artifact previews resolve through the renderer registry; the model only
 * carries the artifact plus its source URL and text-content helper. */
function modelForArtifact(apiBaseUrl: string, artifact: AgentArtifact): PreviewModel {
  const title = artifact.title ?? baseName(artifact.path ?? artifact.url ?? 'Artifact')
  const subtitle = artifact.source === 'url' ? artifact.url : artifact.path
  const icon = iconForFileName(subtitle, artifactKindTag(artifact))
  const src = artifact.source === 'url' ? artifact.url : artifactAssetUrl(apiBaseUrl, artifact.id)

  const fetchText =
    artifact.kind === 'markdown'
      ? async () => {
          const response = await fetch(`${apiBaseUrl}/api/artifacts/${encodeURIComponent(artifact.id)}/content`)
          if (!response.ok) {
            throw new Error(await readError(response))
          }
          const body = (await response.json()) as AgentArtifactMarkdownContentResponse
          return body.content
        }
      : undefined

  return {
    key: `artifact:${artifact.id}`,
    title,
    subtitle,
    icon,
    render: 'artifact',
    src,
    external: src,
    artifact,
    fetchText
  }
}

function ImageArtifactRenderer({ artifact, src }: ArtifactRendererProps) {
  if (!src) {
    return <div className="side-panel-empty">This artifact has no content to preview.</div>
  }
  return (
    <div className="preview-image-frame">
      <img src={src} alt={artifact.title ?? 'Artifact'} />
    </div>
  )
}

function EmbedArtifactRenderer({ artifact, src }: ArtifactRendererProps) {
  if (!src) {
    return <div className="side-panel-empty">This artifact has no content to preview.</div>
  }
  return (
    <iframe
      className="preview-embed-frame"
      src={src}
      title={artifact.title ?? 'Artifact'}
      sandbox="allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
    />
  )
}

function MarkdownArtifactRenderer({ artifact, reloadNonce, fetchText }: ArtifactRendererProps) {
  const [textState, setTextState] = useState<TextState>({ status: 'loading' })

  useEffect(() => {
    if (!fetchText) {
      setTextState({ status: 'error', message: 'This artifact does not expose text content.' })
      return
    }
    const controller = new AbortController()
    fetchText()
      .then((content) => {
        if (!controller.signal.aborted) {
          setTextState({ status: 'ready', content })
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          // Keep showing the previous content when a background reload fails.
          setTextState((current) =>
            current.status === 'ready'
              ? current
              : { status: 'error', message: error instanceof Error ? error.message : String(error) }
          )
        }
      })
    return () => controller.abort()
  }, [fetchText, reloadNonce, artifact.updatedAt])

  if (textState.status === 'loading') {
    return (
      <div className="side-panel-loading">
        <Loader2 className="spin-icon" />
        Loading
      </div>
    )
  }
  if (textState.status === 'error') {
    return <div className="side-panel-empty">{textState.message}</div>
  }
  return (
    <div className="artifact-markdown-frame">
      <article className="artifact-markdown">
        <ReactMarkdown>{textState.content}</ReactMarkdown>
      </article>
    </div>
  )
}

registerArtifactRenderer(builtinRendererKeys.image, ImageArtifactRenderer)
registerArtifactRenderer(builtinRendererKeys.embed, EmbedArtifactRenderer)
registerArtifactRenderer(builtinRendererKeys.markdown, MarkdownArtifactRenderer)
registerArtifactRenderer('chem:ketcher', KetcherArtifactRenderer)

/** Fallback for artifacts declaring a renderer key this build does not know. */
function UnsupportedInteractiveArtifact({
  artifact,
  rendererKey,
  external
}: {
  artifact: AgentArtifact
  rendererKey: string
  external: string | null
}) {
  return (
    <div className="side-panel-empty">
      <span>
        This artifact requires the “{rendererKey}” renderer, which isn’t available here.
        {artifact.mediaType ? ` (${artifact.mediaType})` : ''}
      </span>
      {external ? (
        <Button type="button" variant="outline" size="sm" asChild>
          <a href={external} target="_blank" rel="noreferrer">
            <ExternalLink />
            Open externally
          </a>
        </Button>
      ) : null}
    </div>
  )
}

function modelForFile(apiBaseUrl: string, sessionId: string, file: WorkspaceFile): PreviewModel {
  const raw = fileRawUrl(apiBaseUrl, sessionId, file.path)
  const base = {
    key: `file:${file.path}`,
    title: file.name,
    subtitle: file.path,
    icon: iconForFileName(file.name, file.kind)
  }

  const fetchText = async () => {
    const response = await fetch(raw)
    if (!response.ok) {
      throw new Error(await readError(response))
    }
    return response.text()
  }

  if (file.kind === 'image') {
    return { ...base, render: 'image', src: raw, external: raw }
  }
  if (file.kind === 'markdown') {
    return { ...base, render: 'markdown', src: raw, external: raw, fetchText }
  }
  if (file.kind === 'notebook') {
    return { ...base, render: 'notebook', src: raw, external: raw, filePath: file.path, fetchText }
  }
  if (file.kind === 'text') {
    return { ...base, render: 'text', src: raw, external: raw, fetchText }
  }
  if (file.kind === 'pdf' || file.kind === 'html') {
    return { ...base, render: 'embed', src: raw, external: raw }
  }
  return { ...base, render: 'none', src: null, external: raw }
}

function PreviewSurface({
  model,
  reloadNonce,
  apiBaseUrl,
  sessionId,
  running
}: {
  model: PreviewModel
  reloadNonce: number
  apiBaseUrl: string
  sessionId: string
  running: boolean
}) {
  const [textState, setTextState] = useState<TextState | null>(null)
  const [effectiveReloadNonce, setEffectiveReloadNonce] = useState(reloadNonce)
  const [manualReloadNonce, setManualReloadNonce] = useState(0)
  const [notebookExecuting, setNotebookExecuting] = useState(false)
  const pendingReloadNonce = useRef<number | null>(null)
  const textKey = useRef<string | null>(null)

  useEffect(() => {
    setNotebookExecuting(false)
    pendingReloadNonce.current = null
    setEffectiveReloadNonce(reloadNonce)
  }, [model.key])

  useEffect(() => {
    if (model.render === 'notebook' && notebookExecuting) {
      pendingReloadNonce.current = reloadNonce
      return
    }
    setEffectiveReloadNonce(reloadNonce)
  }, [model.render, notebookExecuting, reloadNonce])

  const onNotebookExecutingChange = useCallback((executing: boolean) => {
    setNotebookExecuting(executing)
    if (!executing && pendingReloadNonce.current !== null) {
      setEffectiveReloadNonce(pendingReloadNonce.current)
      pendingReloadNonce.current = null
    }
  }, [])

  const artifactId = model.render === 'artifact' ? model.artifact?.id ?? null : null
  const artifactStateUrl =
    artifactId === null
      ? null
      : `${apiBaseUrl}/api/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactId)}/state`

  const readState = useCallback(async (): Promise<unknown> => {
    if (!artifactStateUrl) {
      return null
    }
    const response = await fetch(artifactStateUrl)
    if (!response.ok) {
      throw new Error(await readError(response))
    }
    const body = (await response.json()) as AgentArtifactStateResponse
    return body.state
  }, [artifactStateUrl])

  const saveState = useCallback(
    async (state: unknown): Promise<unknown> => {
      if (!artifactStateUrl) {
        return null
      }
      const response = await fetch(artifactStateUrl, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state })
      })
      if (!response.ok) {
        throw new Error(await readError(response))
      }
      const body = (await response.json()) as AgentArtifactStateResponse
      return body.state
    },
    [artifactStateUrl]
  )

  const saveFileUrl =
    artifactId === null
      ? null
      : `${apiBaseUrl}/api/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactId)}/file`

  const saveFile = useCallback(
    async (content: string, mediaType?: string | null): Promise<void> => {
      if (!saveFileUrl) {
        return
      }
      const response = await fetch(saveFileUrl, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content, mediaType: mediaType ?? null })
      })
      if (!response.ok) {
        throw new Error(await readError(response))
      }
      await response.json() as AgentArtifactFileResponse
    },
    [saveFileUrl]
  )

  // Artifact previews own their content fetching (via renderer props), so the
  // workspace-file text machinery below must not fetch for them.
  const fetchText = model.render === 'artifact' ? undefined : model.fetchText
  // reloadNonce is bumped when an agent turn ends so text-based previews
  // (notebooks especially) pick up files the agent just modified.
  useEffect(() => {
    if (!fetchText) {
      setTextState(null)
      textKey.current = null
      return
    }
    const controller = new AbortController()
    const sameKey = textKey.current === model.key
    setTextState((current) => {
      if (sameKey && current?.status === 'ready') {
        return current
      }
      return { status: 'loading' }
    })
    fetchText()
      .then((content) => {
        if (!controller.signal.aborted) {
          textKey.current = model.key
          setTextState({ status: 'ready', content })
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setTextState((current) => {
            if (sameKey && current?.status === 'ready') {
              return current
            }
            return { status: 'error', message: error instanceof Error ? error.message : String(error) }
          })
        }
      })
    return () => controller.abort()
  }, [fetchText, model.key, effectiveReloadNonce, manualReloadNonce])

  if (model.render === 'artifact' && model.artifact) {
    const artifact = model.artifact
    const resolution = resolveArtifactRenderer(artifact)
    if (!resolution.supported) {
      return (
        <UnsupportedInteractiveArtifact artifact={artifact} rendererKey={resolution.key} external={model.external} />
      )
    }
    const Renderer = resolution.Renderer
    return (
      <Suspense
        fallback={
          <div className="side-panel-loading">
            <Loader2 className="spin-icon" />
            Loading
          </div>
        }
      >
        <Renderer
          key={model.key}
          artifact={artifact}
          src={model.src}
          metadata={artifact.metadata ?? null}
          reloadNonce={effectiveReloadNonce}
          fetchText={model.fetchText}
          readState={readState}
          saveState={artifact.editable ? saveState : undefined}
          saveFile={artifact.editable && artifact.source === 'file' ? saveFile : undefined}
        />
      </Suspense>
    )
  }

  if (model.render === 'image' && model.src) {
    return (
      <div className="preview-image-frame">
        <img src={model.src} alt={model.title} />
      </div>
    )
  }

  if (model.render === 'embed' && model.src) {
    return (
      <iframe
        key={model.key}
        className="preview-embed-frame"
        src={model.src}
        title={model.title}
        sandbox="allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
      />
    )
  }

  if (model.render === 'markdown' || model.render === 'text' || model.render === 'notebook') {
    if (!textState || textState.status === 'loading') {
      return (
        <div className="side-panel-loading">
          <Loader2 className="spin-icon" />
          Loading
        </div>
      )
    }
    if (textState.status === 'error') {
      return <div className="side-panel-empty">{textState.message}</div>
    }
    if (model.render === 'notebook') {
      return (
        <div className="nb-frame">
          <Suspense
            fallback={
              <div className="side-panel-loading">
                <Loader2 className="spin-icon" />
                Loading
              </div>
            }
          >
            <NotebookViewer
              content={textState.content}
              apiBaseUrl={model.filePath ? apiBaseUrl : undefined}
              sessionId={model.filePath ? sessionId : undefined}
              filePath={model.filePath}
              running={running}
              onExecutingChange={onNotebookExecutingChange}
              onRequestReload={() => setManualReloadNonce((nonce) => nonce + 1)}
            />
          </Suspense>
        </div>
      )
    }
    if (model.render === 'markdown') {
      return (
        <div className="artifact-markdown-frame">
          <article className="artifact-markdown">
            <ReactMarkdown>{textState.content}</ReactMarkdown>
          </article>
        </div>
      )
    }
    return (
      <div className="preview-text-frame">
        <CodePreview fileName={model.subtitle || model.title} contents={textState.content} />
      </div>
    )
  }

  return (
    <div className="side-panel-empty">
      This file type can’t be previewed.
      {model.external ? (
        <Button type="button" variant="outline" size="sm" asChild>
          <a href={model.external} target="_blank" rel="noreferrer">
            <ExternalLink />
            Open externally
          </a>
        </Button>
      ) : null}
    </div>
  )
}

function ArtifactsPanel({
  apiBaseUrl,
  sessionId,
  artifacts,
  activeArtifactId,
  draft,
  creating,
  running,
  focusFile,
  onDraftChange,
  onCreate,
  onSelectArtifact,
  onClose
}: ArtifactsPanelProps) {
  const [scope, setScope] = useState<Scope>('artifacts')
  const [search, setSearch] = useState('')
  const [selectedFile, setSelectedFile] = useState<WorkspaceFile | null>(null)
  const [workspace, setWorkspace] = useState<WorkspaceState>({ status: 'idle' })
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [reloadNonce, setReloadNonce] = useState(0)
  const wasRunning = useRef(running)

  const loadWorkspace = useCallback(async (): Promise<WorkspaceFile[] | null> => {
    setWorkspace({ status: 'loading' })
    try {
      const response = await fetch(`${apiBaseUrl}/api/sessions/${encodeURIComponent(sessionId)}/files`)
      if (!response.ok) {
        throw new Error(await readError(response))
      }
      const body = (await response.json()) as ListWorkspaceFilesResponse
      setWorkspace({ status: 'ready', files: body.files, truncated: body.truncated })
      return body.files
    } catch (error) {
      setWorkspace({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      return null
    }
  }, [apiBaseUrl, sessionId])

  // Load the workspace listing once per session so scope counts are accurate.
  useEffect(() => {
    setWorkspace({ status: 'idle' })
    setSelectedFile(null)
    setSearch('')
    setExpandedDirs(new Set())
    void loadWorkspace()
  }, [loadWorkspace])

  // When the agent surfaces a new artifact the parent selects it; drop any
  // workspace-file preview so the fresh artifact takes over.
  useEffect(() => {
    if (activeArtifactId) {
      setSelectedFile(null)
    }
  }, [activeArtifactId])

  // A finished agent turn may have created or modified workspace files, so
  // refresh the listing and any open text-based preview on the falling edge.
  useEffect(() => {
    if (wasRunning.current && !running) {
      setReloadNonce((nonce) => nonce + 1)
      void loadWorkspace()
    }
    wasRunning.current = running
  }, [running, loadWorkspace])

  // An agent started executing a notebook: surface it. Refresh the listing
  // (the file may have just been created) and select it in the workspace tab.
  useEffect(() => {
    if (!focusFile) {
      return
    }
    let cancelled = false
    void loadWorkspace().then((files) => {
      if (cancelled || !files) {
        return
      }
      const target = files.find((file) => file.path === focusFile.path)
      if (target) {
        setScope('workspace')
        onSelectArtifact(null)
        setSelectedFile(target)
        setReloadNonce((nonce) => nonce + 1)
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by nonce so repeated activity refocuses
  }, [focusFile?.nonce])

  const activeArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.id === activeArtifactId) ?? null,
    [artifacts, activeArtifactId]
  )

  const preview: PreviewModel | null = useMemo(() => {
    if (selectedFile) {
      return modelForFile(apiBaseUrl, sessionId, selectedFile)
    }
    if (activeArtifact) {
      return modelForArtifact(apiBaseUrl, activeArtifact)
    }
    return null
  }, [apiBaseUrl, sessionId, selectedFile, activeArtifact])

  const workspaceFiles = useMemo(
    () => (workspace.status === 'ready' ? workspace.files : []),
    [workspace]
  )
  const workspaceCount = workspace.status === 'ready' ? workspace.files.length : null

  const filteredArtifacts = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) {
      return artifacts
    }
    return artifacts.filter((artifact) => {
      const haystack = `${artifact.title ?? ''} ${artifact.path ?? artifact.url ?? ''}`.toLowerCase()
      return haystack.includes(query)
    })
  }, [artifacts, search])

  const filteredFiles = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) {
      return workspaceFiles
    }
    return workspaceFiles.filter((file) => file.path.toLowerCase().includes(query))
  }, [workspaceFiles, search])

  const workspaceTree = useMemo(() => buildWorkspaceTree(filteredFiles), [filteredFiles])
  // While searching, matches may live inside collapsed folders — show everything.
  const forceExpand = search.trim().length > 0

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((current) => {
      const next = new Set(current)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  const selectFile = useCallback(
    (file: WorkspaceFile) => {
      onSelectArtifact(null)
      setSelectedFile(file)
    },
    [onSelectArtifact]
  )

  const backToList = useCallback(() => {
    setSelectedFile(null)
    onSelectArtifact(null)
  }, [onSelectArtifact])

  // Each scope is a distinct corpus, so a leftover query shouldn't silently
  // hide the other scope's contents.
  const selectScope = useCallback((next: Scope) => {
    setScope(next)
    setSearch('')
  }, [])

  const submitReference = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (draft.trim().length > 0 && !creating) {
      onCreate(draft)
    }
  }

  if (preview) {
    return (
      <aside className="side-panel">
        <header className="side-panel-header">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Back to list"
            title="Back to list"
            onClick={backToList}
          >
            <ArrowLeft />
          </Button>
          <div className="side-panel-title-group">
            <div className="side-panel-icon">{preview.icon}</div>
            <div className="side-panel-copy">
              <h2>{preview.title}</h2>
              <span>{preview.subtitle}</span>
            </div>
          </div>
          <div className="side-panel-actions">
            {preview.external ? (
              <Button type="button" variant="ghost" size="icon-sm" asChild aria-label="Open externally" title="Open externally">
                <a href={preview.external} target="_blank" rel="noreferrer">
                  <ExternalLink />
                </a>
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Close panel" title="Close panel" onClick={onClose}>
              <X />
            </Button>
          </div>
        </header>
        <div className="side-panel-body">
          <PreviewSurface
            model={preview}
            reloadNonce={reloadNonce}
            apiBaseUrl={apiBaseUrl}
            sessionId={sessionId}
            running={running}
          />
        </div>
      </aside>
    )
  }

  return (
    <aside className="side-panel">
      <header className="side-panel-header">
        <div className="side-panel-title-group">
          <h2 className="side-panel-heading">Artifacts</h2>
        </div>
        <div className="side-panel-actions">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh workspace"
            title="Refresh workspace"
            disabled={workspace.status === 'loading'}
            onClick={() => void loadWorkspace()}
          >
            <RefreshCw />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Close panel" title="Close panel" onClick={onClose}>
            <X />
          </Button>
        </div>
      </header>

      <div className="browser-controls">
        <div className="scope-tabs" role="tablist" aria-label="Artifact scope">
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'artifacts'}
            className={`scope-tab ${scope === 'artifacts' ? 'is-active' : ''}`}
            onClick={() => selectScope('artifacts')}
          >
            Session
            <span className="scope-count">{artifacts.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'workspace'}
            className={`scope-tab ${scope === 'workspace' ? 'is-active' : ''}`}
            onClick={() => selectScope('workspace')}
          >
            Workspace
            <span className="scope-count">{workspaceCount ?? '·'}</span>
          </button>
        </div>
        <div className="browser-search">
          <Search />
          <Input
            value={search}
            placeholder={scope === 'artifacts' ? 'Search artifacts…' : 'Search workspace files…'}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      <ScrollArea className="browser-scroll">
        {scope === 'artifacts' ? (
          <div className="browser-list">
            {filteredArtifacts.length === 0 ? (
              <div className="side-panel-empty">
                {artifacts.length === 0
                  ? 'No artifacts yet. The agent’s generated files will appear here.'
                  : 'No artifacts match your search.'}
              </div>
            ) : (
              filteredArtifacts.map((artifact) => {
                const subtitle = artifact.source === 'url' ? artifact.url : artifact.path
                return (
                  <button
                    key={artifact.id}
                    type="button"
                    className={`browser-item ${artifact.id === activeArtifactId ? 'is-active' : ''}`}
                    onClick={() => {
                      setSelectedFile(null)
                      onSelectArtifact(artifact.id)
                    }}
                  >
                    <span className="browser-item-icon">{iconForFileName(subtitle, artifactKindTag(artifact))}</span>
                    <span className="browser-item-copy">
                      <span className="browser-item-name">{artifact.title ?? baseName(subtitle)}</span>
                      <span className="browser-item-path">{subtitle}</span>
                    </span>
                  </button>
                )
              })
            )}
          </div>
        ) : workspace.status === 'loading' ? (
          <div className="side-panel-loading">
            <Loader2 className="spin-icon" />
            Reading workspace
          </div>
        ) : workspace.status === 'error' ? (
          <div className="side-panel-empty">{workspace.message}</div>
        ) : (
          <div className="browser-tree">
            {filteredFiles.length === 0 ? (
              <div className="side-panel-empty">
                {workspaceFiles.length === 0 ? 'No files found in the workspace.' : 'No files match your search.'}
              </div>
            ) : (
              <WorkspaceTreeLevel
                dir={workspaceTree}
                depth={0}
                expandedDirs={expandedDirs}
                forceExpand={forceExpand}
                onToggleDir={toggleDir}
                onSelectFile={selectFile}
              />
            )}
            {workspace.status === 'ready' && workspace.truncated ? (
              <div className="browser-note">Showing the first {workspaceFiles.length} files. Narrow with search.</div>
            ) : null}
          </div>
        )}
      </ScrollArea>

      {scope === 'artifacts' ? (
        <form className="browser-add" onSubmit={submitReference}>
          <Input
            value={draft}
            placeholder="Add a URL or file path…"
            disabled={creating}
            onChange={(event) => onDraftChange(event.target.value)}
          />
          <Button type="submit" variant="outline" size="sm" disabled={draft.trim().length === 0 || creating}>
            {creating ? <Loader2 className="spin-icon" /> : <Plus />}
            Add
          </Button>
        </form>
      ) : null}
    </aside>
  )
}

export { ArtifactsPanel }
