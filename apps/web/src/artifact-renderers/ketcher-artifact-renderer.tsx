import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2, RefreshCw, Save } from 'lucide-react'
import { Editor } from 'ketcher-react'
import { StandaloneStructServiceProvider } from 'ketcher-standalone'
import type { Ketcher } from 'ketcher-core'
import 'ketcher-react/dist/index.css'

import { Button } from '@open-science/ui'
import type { ArtifactRendererProps } from '../lib/artifact-renderers'

const ketMediaType = 'application/vnd.ketcher.ket+json'

const structServiceProvider = new StandaloneStructServiceProvider()

type KetcherArtifactState = {
  version: 1
  ket?: string
  smiles?: string
  molfile?: string
  rxnfile?: string
  dirty: boolean
  updatedAt: string
  lastExportedAt?: string
}

type Status =
  | { kind: 'loading'; message: string }
  | { kind: 'ready'; message: string }
  | { kind: 'saving'; message: string }
  | { kind: 'error'; message: string }

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function parseKetcherState(value: unknown): Partial<KetcherArtifactState> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>
  return {
    ket: stringField(record.ket),
    smiles: stringField(record.smiles),
    molfile: stringField(record.molfile),
    rxnfile: stringField(record.rxnfile)
  }
}

async function readArtifactText(src: string | null): Promise<string | null> {
  if (!src) {
    return null
  }
  const response = await fetch(src)
  if (!response.ok) {
    return null
  }
  const text = await response.text()
  return text.trim().length > 0 ? text : null
}

async function maybeExport(
  name: string,
  exportFn: () => Promise<string>,
  isValid: (value: string) => boolean = () => true
): Promise<string | undefined> {
  try {
    const value = await exportFn()
    const trimmed = value.trim()
    return trimmed.length > 0 && isValid(trimmed) ? trimmed : undefined
  } catch {
    if (name === 'ket') {
      throw new Error('Ketcher could not export KET for the current structure.')
    }
    return undefined
  }
}

function looksLikeMolfile(value: string): boolean {
  return value.includes('M  END')
}

async function exportStructure(ketcher: Ketcher, dirty: boolean): Promise<KetcherArtifactState> {
  const [ket, smiles, molfile, rxnfile] = await Promise.all([
    maybeExport('ket', () => ketcher.getKet()),
    maybeExport('smiles', () => ketcher.getSmiles()),
    maybeExport('molfile', () => ketcher.getMolfile('v2000'), looksLikeMolfile),
    maybeExport('rxnfile', () => ketcher.getRxn('v2000'))
  ])
  return {
    version: 1,
    ...(ket ? { ket } : {}),
    ...(smiles ? { smiles } : {}),
    ...(molfile ? { molfile } : {}),
    ...(rxnfile ? { rxnfile } : {}),
    dirty,
    updatedAt: new Date().toISOString()
  }
}

function initialStructureFrom(state: Partial<KetcherArtifactState> | null, fileText: string | null): string | null {
  return state?.ket ?? state?.molfile ?? state?.rxnfile ?? state?.smiles ?? fileText
}

function stateFingerprint(state: Partial<KetcherArtifactState> | null): string | null {
  if (!state) {
    return null
  }
  return JSON.stringify({
    ket: state.ket ?? null,
    molfile: state.molfile ?? null,
    rxnfile: state.rxnfile ?? null,
    smiles: state.smiles ?? null
  })
}

export function KetcherArtifactRenderer({
  artifact,
  src,
  metadata,
  reloadNonce,
  readState,
  saveState,
  saveFile
}: ArtifactRendererProps) {
  const [ketcher, setKetcher] = useState<Ketcher | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'loading', message: 'Loading Ketcher' })
  const [dirty, setDirty] = useState(false)
  const initializing = useRef(false)
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastAppliedState = useRef<string | null>(null)

  const persistState = useCallback(
    async (state: KetcherArtifactState) => {
      if (saveState) {
        await saveState(state)
      }
      lastAppliedState.current = stateFingerprint(state)
      setDirty(state.dirty)
      setStatus({
        kind: 'ready',
        message: state.dirty ? 'Unsaved changes' : 'Saved'
      })
    },
    [saveState]
  )

  const exportAndPersist = useCallback(
    async (instance: Ketcher, nextDirty: boolean) => {
      const state = await exportStructure(instance, nextDirty)
      await persistState(state)
      return state
    },
    [persistState]
  )

  useEffect(() => {
    if (!ketcher) {
      return
    }

    const instance = ketcher
    let cancelled = false
    initializing.current = true
    setStatus({ kind: 'loading', message: 'Opening structure' })

    async function initialize() {
      try {
        const [stateValue, fileText] = await Promise.all([readState ? readState() : Promise.resolve(null), readArtifactText(src)])
        if (cancelled) {
          return
        }
        const parsedState = parseKetcherState(stateValue)
        const initial = initialStructureFrom(parsedState, fileText)
        if (initial) {
          await instance.setMolecule(initial, { needZoom: true })
          lastAppliedState.current = stateFingerprint(parsedState)
        }
        if (cancelled) {
          return
        }
        if (initial) {
          await exportAndPersist(instance, false)
        } else {
          setStatus({ kind: 'ready', message: 'Ready' })
        }
      } catch (error) {
        if (!cancelled) {
          setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
        }
      } finally {
        initializing.current = false
      }
    }

    void initialize()

    return () => {
      cancelled = true
      initializing.current = false
    }
  }, [exportAndPersist, ketcher, readState, src])

  useEffect(() => {
    if (!ketcher || !readState || initializing.current) {
      return
    }
    const instance = ketcher
    const readLatestState = readState

    let cancelled = false
    async function reloadExternalState() {
      try {
        const parsedState = parseKetcherState(await readLatestState())
        const fingerprint = stateFingerprint(parsedState)
        if (cancelled || !fingerprint || fingerprint === lastAppliedState.current) {
          return
        }
        const initial = initialStructureFrom(parsedState, null)
        if (!initial) {
          return
        }
        initializing.current = true
        setStatus({ kind: 'loading', message: 'Loading updated structure' })
        await instance.setMolecule(initial, { needZoom: true })
        if (cancelled) {
          return
        }
        lastAppliedState.current = fingerprint
        await exportAndPersist(instance, parsedState?.dirty === true)
      } catch (error) {
        if (!cancelled) {
          setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
        }
      } finally {
        initializing.current = false
      }
    }

    void reloadExternalState()

    return () => {
      cancelled = true
    }
  }, [artifact.updatedAt, exportAndPersist, ketcher, readState, reloadNonce])

  const scheduleSync = useCallback(() => {
    if (!ketcher || initializing.current) {
      return
    }
    setDirty(true)
    setStatus({ kind: 'ready', message: 'Unsaved changes' })
    if (syncTimer.current) {
      clearTimeout(syncTimer.current)
    }
    syncTimer.current = setTimeout(() => {
      void exportAndPersist(ketcher, true).catch((error: unknown) => {
        setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      })
    }, 700)
  }, [exportAndPersist, ketcher])

  useEffect(() => {
    if (!ketcher || !saveState) {
      return
    }
    ketcher.changeEvent.add(scheduleSync)
    return () => {
      ketcher.changeEvent.remove(scheduleSync)
      if (syncTimer.current) {
        clearTimeout(syncTimer.current)
      }
    }
  }, [ketcher, saveState, scheduleSync])

  const handleSave = useCallback(async () => {
    if (!ketcher || !saveFile) {
      return
    }
    setStatus({ kind: 'saving', message: 'Saving' })
    try {
      const state = await exportStructure(ketcher, false)
      const savedAt = new Date().toISOString()
      const savedState = { ...state, dirty: false, lastExportedAt: savedAt }
      await saveFile(state.ket ?? state.molfile ?? state.rxnfile ?? state.smiles ?? '', ketMediaType)
      await persistState(savedState)
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }, [ketcher, persistState, saveFile])

  const handleRefresh = useCallback(() => {
    if (ketcher) {
      void exportAndPersist(ketcher, dirty).catch((error: unknown) => {
        setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      })
    }
  }, [dirty, exportAndPersist, ketcher])

  const title = typeof metadata?.title === 'string' ? metadata.title : artifact.title ?? artifact.path

  return (
    <div className="ketcher-artifact">
      <div className="ketcher-artifact-toolbar">
        <div className="ketcher-artifact-title">
          <span className="renderer-dot" />
          <span>Ketcher Chemistry</span>
          <span className="renderer-breadcrumb">open_sketcher</span>
          {title ? <span className="renderer-title">{title}</span> : null}
        </div>
        <div className="ketcher-artifact-actions">
          <span className={`ketcher-status ketcher-status-${status.kind}`}>
            {status.kind === 'loading' || status.kind === 'saving' ? <Loader2 className="spin-icon" /> : null}
            {status.kind === 'error' ? <AlertTriangle /> : null}
            {status.message}
          </span>
          <Button type="button" variant="ghost" size="icon" title="Refresh exports" onClick={handleRefresh}>
            <RefreshCw />
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={!saveFile || !dirty} onClick={handleSave}>
            <Save />
            Save
          </Button>
        </div>
      </div>
      <div className="ketcher-editor-frame">
        <Editor
          staticResourcesUrl=""
          structServiceProvider={structServiceProvider}
          errorHandler={(message) => setStatus({ kind: 'error', message })}
          disableMacromoleculesEditor
          onInit={setKetcher}
        />
      </div>
    </div>
  )
}
