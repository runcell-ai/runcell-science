import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
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
  Plus,
  RefreshCw,
  Search,
  Sheet as SheetIcon,
  X
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type {
  AgentArtifact,
  AgentArtifactMarkdownContentResponse,
  ListWorkspaceFilesResponse,
  WorkspaceFile,
  WorkspaceFileKind
} from '@open-science/contracts'
import { Button, Input, ScrollArea } from '@open-science/ui'

type ArtifactsPanelProps = {
  apiBaseUrl: string
  sessionId: string
  artifacts: AgentArtifact[]
  activeArtifactId: string | null
  draft: string
  creating: boolean
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
  render: 'image' | 'markdown' | 'text' | 'embed' | 'none'
  src: string | null
  external: string | null
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

function modelForArtifact(apiBaseUrl: string, artifact: AgentArtifact): PreviewModel {
  const title = artifact.title ?? baseName(artifact.path ?? artifact.url ?? 'Artifact')
  const subtitle = artifact.source === 'url' ? artifact.url : artifact.path
  const icon = iconForFileName(subtitle, artifactKindTag(artifact))
  const base = { key: `artifact:${artifact.id}`, title, subtitle, icon }

  if (artifact.kind === 'url') {
    return { ...base, render: 'embed', src: artifact.url, external: artifact.url }
  }

  const asset = artifactAssetUrl(apiBaseUrl, artifact.id)
  if (artifact.kind === 'image') {
    return { ...base, render: 'image', src: asset, external: asset }
  }
  if (artifact.kind === 'markdown') {
    return {
      ...base,
      render: 'markdown',
      src: asset,
      external: asset,
      fetchText: async () => {
        const response = await fetch(`${apiBaseUrl}/api/artifacts/${encodeURIComponent(artifact.id)}/content`)
        if (!response.ok) {
          throw new Error(await readError(response))
        }
        const body = (await response.json()) as AgentArtifactMarkdownContentResponse
        return body.content
      }
    }
  }
  return { ...base, render: 'embed', src: asset, external: asset }
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
  if (file.kind === 'text') {
    return { ...base, render: 'text', src: raw, external: raw, fetchText }
  }
  if (file.kind === 'pdf' || file.kind === 'html') {
    return { ...base, render: 'embed', src: raw, external: raw }
  }
  return { ...base, render: 'none', src: null, external: raw }
}

function PreviewSurface({ model }: { model: PreviewModel }) {
  const [textState, setTextState] = useState<TextState | null>(null)

  const fetchText = model.fetchText
  useEffect(() => {
    if (!fetchText) {
      setTextState(null)
      return
    }
    const controller = new AbortController()
    setTextState({ status: 'loading' })
    fetchText()
      .then((content) => {
        if (!controller.signal.aborted) {
          setTextState({ status: 'ready', content })
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setTextState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
        }
      })
    return () => controller.abort()
  }, [fetchText, model.key])

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

  if (model.render === 'markdown' || model.render === 'text') {
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
        <pre className="preview-text">{textState.content}</pre>
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

  const loadWorkspace = useCallback(async () => {
    setWorkspace({ status: 'loading' })
    try {
      const response = await fetch(`${apiBaseUrl}/api/sessions/${encodeURIComponent(sessionId)}/files`)
      if (!response.ok) {
        throw new Error(await readError(response))
      }
      const body = (await response.json()) as ListWorkspaceFilesResponse
      setWorkspace({ status: 'ready', files: body.files, truncated: body.truncated })
    } catch (error) {
      setWorkspace({ status: 'error', message: error instanceof Error ? error.message : String(error) })
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
          <PreviewSurface model={preview} />
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
