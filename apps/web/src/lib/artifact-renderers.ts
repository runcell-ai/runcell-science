// Generic artifact renderer registry. Artifacts carry an optional stable
// `rendererKey`; the artifacts panel resolves that key here to decide which
// component renders the preview. Built-in previews (image/pdf/markdown/html/
// url) register under `builtin:*` keys; domain packages can register custom
// renderers without the panel knowing about them. Unknown keys resolve to an
// unsupported-artifact fallback so a newer server never breaks the panel.

import type { ComponentType } from 'react'
import type { AgentArtifact } from '@open-science/contracts'

/** Stable props every artifact renderer receives. */
export interface ArtifactRendererProps {
  artifact: AgentArtifact
  /** URL serving the artifact bytes (asset route for files, the url itself for url artifacts). */
  src: string | null
  /** Parsed renderer-defined metadata declared on the artifact, if any. */
  metadata: Record<string, unknown> | null
  /** Bumped when the backing content may have changed; re-fetch on change. */
  reloadNonce: number
  /** Reads the artifact's text content, where the artifact kind exposes it. */
  fetchText?: () => Promise<string>
  /** Reads the artifact's persisted JSON state. */
  readState?: () => Promise<unknown>
  /** Writes the artifact's persisted JSON state. Absent on read-only artifacts. */
  saveState?: (state: unknown) => Promise<unknown>
  /** Writes the artifact's backing file. Absent on read-only or non-file artifacts. */
  saveFile?: (content: string, mediaType?: string | null) => Promise<void>
}

export type ArtifactRenderer = ComponentType<ArtifactRendererProps>

export const builtinRendererKeys = {
  image: 'builtin:image',
  embed: 'builtin:embed',
  markdown: 'builtin:markdown'
} as const

const registry = new Map<string, ArtifactRenderer>()

/** Registers a renderer; returns a disposer that removes this registration. */
export function registerArtifactRenderer(key: string, renderer: ArtifactRenderer): () => void {
  registry.set(key, renderer)
  return () => {
    if (registry.get(key) === renderer) {
      registry.delete(key)
    }
  }
}

export function getArtifactRenderer(key: string): ArtifactRenderer | null {
  return registry.get(key) ?? null
}

/**
 * The renderer key an artifact resolves to: its declared key when present,
 * otherwise the built-in key for its kind.
 */
export function rendererKeyForArtifact(artifact: AgentArtifact): string {
  if (artifact.rendererKey) {
    return artifact.rendererKey
  }
  if (artifact.kind === 'custom') {
    return 'custom'
  }
  switch (artifact.kind) {
    case 'image':
      return builtinRendererKeys.image
    case 'markdown':
      return builtinRendererKeys.markdown
    // pdf, html, and url artifacts all embed in an iframe.
    default:
      return builtinRendererKeys.embed
  }
}

export type ArtifactRendererResolution =
  | { supported: true; key: string; Renderer: ArtifactRenderer }
  | { supported: false; key: string }

export function resolveArtifactRenderer(artifact: AgentArtifact): ArtifactRendererResolution {
  const key = rendererKeyForArtifact(artifact)
  const Renderer = getArtifactRenderer(key)
  return Renderer ? { supported: true, key, Renderer } : { supported: false, key }
}
