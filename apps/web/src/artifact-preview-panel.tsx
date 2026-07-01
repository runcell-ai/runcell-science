import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { ExternalLink, FileText, Globe2, Image as ImageIcon, Loader2, RefreshCw, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { AgentArtifact, AgentArtifactMarkdownContentResponse } from '@open-science/contracts'
import { Button, Input } from '@open-science/ui'

type ArtifactPreviewPanelProps = {
  artifact: AgentArtifact | null
  apiBaseUrl: string
  draft: string
  creating: boolean
  onDraftChange: (value: string) => void
  onCreate: (value: string) => void
  onClose: () => void
}

type MarkdownState =
  | { status: 'idle'; content: string | null; error: string | null }
  | { status: 'loading'; content: string | null; error: string | null }
  | { status: 'ready'; content: string; error: null }
  | { status: 'error'; content: string | null; error: string }

function titleForArtifact(artifact: AgentArtifact): string {
  return artifact.title ?? artifact.path ?? artifact.url ?? 'Artifact'
}

function labelForArtifact(artifact: AgentArtifact): string {
  if (artifact.source === 'url') {
    return artifact.url
  }
  return artifact.path
}

function assetUrl(apiBaseUrl: string, artifactId: string): string {
  return `${apiBaseUrl}/api/artifacts/${encodeURIComponent(artifactId)}/asset/`
}

function contentUrl(apiBaseUrl: string, artifactId: string): string {
  return `${apiBaseUrl}/api/artifacts/${encodeURIComponent(artifactId)}/content`
}

function iconForArtifact(artifact: AgentArtifact | null) {
  if (!artifact) {
    return <FileText />
  }
  if (artifact.kind === 'url') {
    return <Globe2 />
  }
  if (artifact.kind === 'image') {
    return <ImageIcon />
  }
  return <FileText />
}

function ArtifactPreviewPanel({
  artifact,
  apiBaseUrl,
  draft,
  creating,
  onDraftChange,
  onCreate,
  onClose
}: ArtifactPreviewPanelProps) {
  const [markdownState, setMarkdownState] = useState<MarkdownState>({
    status: 'idle',
    content: null,
    error: null
  })
  const [refreshKey, setRefreshKey] = useState(0)

  const artifactSource = useMemo(() => {
    if (!artifact) {
      return null
    }
    if (artifact.source === 'url') {
      return artifact.url
    }
    return assetUrl(apiBaseUrl, artifact.id)
  }, [apiBaseUrl, artifact])

  useEffect(() => {
    if (!artifact || artifact.kind !== 'markdown') {
      setMarkdownState({ status: 'idle', content: null, error: null })
      return
    }

    const controller = new AbortController()
    setMarkdownState((current) => ({
      status: 'loading',
      content: current.content,
      error: null
    }))

    fetch(contentUrl(apiBaseUrl, artifact.id), { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null)
        if (!response.ok) {
          const message =
            body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object'
              ? String((body.error as { message?: unknown }).message ?? response.statusText)
              : response.statusText
          throw new Error(message)
        }
        return body as AgentArtifactMarkdownContentResponse
      })
      .then((response) => {
        setMarkdownState({
          status: 'ready',
          content: response.content,
          error: null
        })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return
        }
        setMarkdownState({
          status: 'error',
          content: null,
          error: error instanceof Error ? error.message : String(error)
        })
      })

    return () => controller.abort()
  }, [apiBaseUrl, artifact, refreshKey])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onCreate(draft)
  }

  const canSubmit = draft.trim().length > 0 && !creating

  return (
    <aside className="artifact-preview-panel">
      <header className="artifact-preview-header">
        <div className="artifact-preview-title-group">
          <div className="artifact-preview-icon">{iconForArtifact(artifact)}</div>
          <div className="artifact-preview-copy">
            <h2>{artifact ? titleForArtifact(artifact) : 'Preview'}</h2>
            <span>{artifact ? labelForArtifact(artifact) : 'Open a URL or a supported local file'}</span>
          </div>
        </div>
        <div className="artifact-preview-actions">
          {artifactSource ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Refresh preview"
              title="Refresh preview"
              onClick={() => setRefreshKey((value) => value + 1)}
            >
              <RefreshCw />
            </Button>
          ) : null}
          {artifactSource ? (
            <Button type="button" variant="ghost" size="icon-sm" asChild aria-label="Open externally" title="Open externally">
              <a href={artifactSource} target="_blank" rel="noreferrer">
                <ExternalLink />
              </a>
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Close preview" title="Close preview" onClick={onClose}>
            <X />
          </Button>
        </div>
      </header>

      <form className="artifact-open-form" onSubmit={submit}>
        <Input
          value={draft}
          placeholder="https://example.com or path/to/file.md"
          disabled={creating}
          onChange={(event) => onDraftChange(event.target.value)}
        />
        <Button type="submit" variant="outline" size="sm" disabled={!canSubmit}>
          {creating ? <Loader2 className="spin-icon" /> : null}
          Open
        </Button>
      </form>

      <div className="artifact-preview-body">
        {!artifact ? (
          <div className="artifact-empty-state">No artifact selected</div>
        ) : artifact.kind === 'image' && artifactSource ? (
          <div className="artifact-image-frame">
            <img key={refreshKey} src={artifactSource} alt={titleForArtifact(artifact)} />
          </div>
        ) : artifact.kind === 'markdown' ? (
          <div className="artifact-markdown-frame">
            {markdownState.status === 'loading' ? (
              <div className="artifact-loading">
                <Loader2 className="spin-icon" />
                Loading Markdown
              </div>
            ) : null}
            {markdownState.status === 'error' ? (
              <div className="artifact-empty-state">{markdownState.error}</div>
            ) : null}
            {markdownState.content ? (
              <article className="artifact-markdown">
                <ReactMarkdown>{markdownState.content}</ReactMarkdown>
              </article>
            ) : null}
          </div>
        ) : artifactSource ? (
          <iframe
            key={`${artifact.id}:${refreshKey}`}
            className="artifact-browser-frame"
            src={artifactSource}
            title={titleForArtifact(artifact)}
            sandbox="allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
          />
        ) : (
          <div className="artifact-empty-state">Artifact cannot be previewed</div>
        )}
      </div>
    </aside>
  )
}

export { ArtifactPreviewPanel }
