import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ApiErrorResponse,
  JupyterInstallIpykernelResponse,
  JupyterPythonEnvStatus,
  JupyterServerConnectionResponse
} from '@runcell-science/contracts'
import { KernelSession } from './kernel-session'
import type { ExecuteCellStatus, JupyterConnection, KernelStatus } from './kernel-session'
import { NotebookDoc } from './notebook-doc'
import type { NotebookRawOutput } from './notebook-doc'
import type { NotebookDocument } from './nbformat'

export type NotebookExecutionState = 'disconnected' | 'connecting' | 'ready' | 'busy' | 'env-missing' | 'error'
export type NotebookCellExecutionState = 'queued' | 'running' | 'done' | 'failed'
export type NotebookSaveState = 'idle' | 'saving' | 'saved' | 'conflict' | 'error'

export interface UseNotebookExecutionOptions {
  content: string
  apiBaseUrl?: string
  sessionId?: string
  filePath?: string
  agentRunning?: boolean
  onExecutingChange?: (executing: boolean) => void
  onRequestReload?: () => void
}

export interface NotebookExecutionController {
  document: NotebookDocument
  parseError: string | null
  version: number
  executionCapable: boolean
  state: NotebookExecutionState
  kernelStatus: KernelStatus
  envStatus: JupyterPythonEnvStatus | null
  error: string | null
  cellStates: Record<string, NotebookCellExecutionState>
  saveState: NotebookSaveState
  saveError: string | null
  installingIpykernel: boolean
  runCell: (cellId: string) => Promise<void>
  runAll: () => Promise<void>
  interrupt: () => Promise<void>
  restart: () => Promise<void>
  dismissEnvMissing: () => void
  installIpykernel: () => Promise<void>
  reloadAfterConflict: () => void
}

type ContentsMetadata = { last_modified?: string }

const saveDelayMs = 1500

function contentsUrl(connection: JupyterConnection, filePath: string, content: boolean): string {
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/')
  return `${connection.baseUrl}api/contents/${encodedPath}?content=${content ? '1' : '0'}`
}

async function readApiError(response: Response): Promise<{ message: string; body: ApiErrorResponse | null }> {
  const body = (await response.json().catch(() => null)) as ApiErrorResponse | null
  return {
    message: body?.error?.message ?? response.statusText,
    body
  }
}

function parseEnvStatus(body: ApiErrorResponse | null): JupyterPythonEnvStatus | null {
  const details = body?.error.details
  if (!details || typeof details !== 'object' || !('python' in details)) {
    return null
  }
  const python = (details as { python?: Partial<JupyterPythonEnvStatus> }).python
  if (!python) {
    return null
  }
  return {
    pythonPath: typeof python.pythonPath === 'string' ? python.pythonPath : null,
    hasIpykernel: python.hasIpykernel === true
  }
}

function newerThan(left: string | undefined, right: string | null): boolean {
  if (!left || !right) {
    return false
  }
  return new Date(left).getTime() > new Date(right).getTime()
}

function createParsedDoc(content: string): { doc: NotebookDoc | null; error: string | null } {
  try {
    return { doc: new NotebookDoc(content), error: null }
  } catch (error) {
    return { doc: null, error: error instanceof Error ? error.message : String(error) }
  }
}

export function useNotebookExecution(options: UseNotebookExecutionOptions): NotebookExecutionController {
  // apiBaseUrl is '' in dev (requests go through the Vite proxy), so test for
  // presence, not truthiness.
  const executionCapable = options.apiBaseUrl !== undefined && Boolean(options.sessionId) && Boolean(options.filePath)
  const [{ doc, error: parseError }, setParsed] = useState(() => createParsedDoc(options.content))
  const [version, setVersion] = useState(0)
  const [state, setState] = useState<NotebookExecutionState>('disconnected')
  const [kernelStatus, setKernelStatus] = useState<KernelStatus>('unknown')
  const [envStatus, setEnvStatus] = useState<JupyterPythonEnvStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cellStates, setCellStates] = useState<Record<string, NotebookCellExecutionState>>({})
  const [saveState, setSaveState] = useState<NotebookSaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [installingIpykernel, setInstallingIpykernel] = useState(false)

  const docRef = useRef<NotebookDoc | null>(doc)
  const sessionRef = useRef<KernelSession | null>(null)
  const connectionRef = useRef<JupyterConnection | null>(null)
  const baselineRef = useRef<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingOutputsRef = useRef<Record<string, NotebookRawOutput[]>>({})
  const pendingClearWaitRef = useRef<Record<string, boolean>>({})
  const savingRef = useRef(false)

  useEffect(() => {
    const parsed = createParsedDoc(options.content)
    setParsed(parsed)
    docRef.current = parsed.doc
    pendingOutputsRef.current = {}
    pendingClearWaitRef.current = {}
    setVersion((current) => current + 1)
    setCellStates({})
    setSaveState('idle')
    setSaveError(null)
  }, [options.content])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
      sessionRef.current?.dispose()
      sessionRef.current = null
    }
  }, [])

  const refreshBaseline = useCallback(async () => {
    if (!connectionRef.current || !options.filePath) {
      return
    }
    const response = await fetch(contentsUrl(connectionRef.current, options.filePath, false), {
      headers: { Authorization: `token ${connectionRef.current.token}` }
    })
    if (!response.ok) {
      throw new Error((await readApiError(response)).message)
    }
    const metadata = (await response.json()) as ContentsMetadata
    baselineRef.current = metadata.last_modified ?? null
  }, [options.filePath])

  const flushSave = useCallback(async () => {
    if (!docRef.current || !connectionRef.current || !options.filePath || savingRef.current || saveState === 'conflict') {
      return
    }
    savingRef.current = true
    setSaveState('saving')
    setSaveError(null)
    try {
      const metadataResponse = await fetch(contentsUrl(connectionRef.current, options.filePath, false), {
        headers: { Authorization: `token ${connectionRef.current.token}` }
      })
      if (!metadataResponse.ok) {
        throw new Error((await readApiError(metadataResponse)).message)
      }
      const metadata = (await metadataResponse.json()) as ContentsMetadata
      if (newerThan(metadata.last_modified, baselineRef.current)) {
        setSaveState('conflict')
        setSaveError('The notebook changed on disk before execution outputs could be saved.')
        return
      }

      const putResponse = await fetch(contentsUrl(connectionRef.current, options.filePath, true), {
        method: 'PUT',
        headers: {
          Authorization: `token ${connectionRef.current.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: 'notebook',
          format: 'json',
          content: docRef.current.toJSON()
        })
      })
      if (!putResponse.ok) {
        throw new Error((await readApiError(putResponse)).message)
      }
      const updated = (await putResponse.json()) as ContentsMetadata
      baselineRef.current = updated.last_modified ?? metadata.last_modified ?? baselineRef.current
      setSaveState('saved')
    } catch (saveError) {
      setSaveState('error')
      setSaveError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      savingRef.current = false
    }
  }, [options.filePath, saveState])

  const scheduleSave = useCallback(() => {
    if (!executionCapable || !connectionRef.current || saveState === 'conflict') {
      return
    }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      void flushSave()
    }, saveDelayMs)
  }, [executionCapable, flushSave, saveState])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const flushOnPageHide = () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
        void flushSave()
      }
    }
    window.addEventListener('pagehide', flushOnPageHide)
    return () => window.removeEventListener('pagehide', flushOnPageHide)
  }, [flushSave])

  const mutateDocument = useCallback(
    (mutator: (doc: NotebookDoc) => void) => {
      if (!docRef.current) {
        return
      }
      mutator(docRef.current)
      setParsed({ doc: docRef.current, error: null })
      setVersion((current) => current + 1)
      scheduleSave()
    },
    [scheduleSave]
  )

  const ensureKernel = useCallback(async (): Promise<KernelSession> => {
    if (sessionRef.current) {
      return sessionRef.current
    }
    if (options.apiBaseUrl === undefined || !options.sessionId || !options.filePath) {
      throw new Error('Notebook execution is not available for this preview.')
    }
    setState('connecting')
    setError(null)
    setEnvStatus(null)

    const response = await fetch(`${options.apiBaseUrl}/api/sessions/${encodeURIComponent(options.sessionId)}/jupyter`, {
      method: 'POST'
    })
    if (!response.ok) {
      const { message, body } = await readApiError(response)
      if (response.status === 409 && body?.error.code === 'jupyter_env_missing') {
        setEnvStatus(parseEnvStatus(body))
        setState('env-missing')
        throw new Error(message)
      }
      setError(message)
      setState('error')
      throw new Error(message)
    }

    const connection = (await response.json()) as JupyterServerConnectionResponse
    connectionRef.current = connection
    const session = await KernelSession.connect({
      connection,
      path: options.filePath,
      onStatusChange: setKernelStatus
    })
    sessionRef.current = session
    await refreshBaseline()
    setKernelStatus(session.status)
    setState('ready')
    return session
  }, [options.apiBaseUrl, options.filePath, options.sessionId, refreshBaseline])

  const executeCell = useCallback(
    async (cellId: string): Promise<ExecuteCellStatus> => {
      if (options.agentRunning) {
        return 'abort'
      }
      const currentDoc = docRef.current
      const cell = currentDoc?.document.cells.find((candidate) => candidate.id === cellId)
      if (!cell || cell.type !== 'code') {
        return 'ok'
      }
      let session: KernelSession
      try {
        session = await ensureKernel()
      } catch {
        // ensureKernel already surfaced the failure via state/envStatus; the
        // cell never ran, so drop it back to idle instead of leaving it queued.
        setCellStates((current) => {
          const next = { ...current }
          delete next[cellId]
          return next
        })
        return 'error'
      }
      setState('busy')
      setCellStates((current) => ({ ...current, [cellId]: 'running' }))
      pendingOutputsRef.current[cellId] = []
      pendingClearWaitRef.current[cellId] = false
      mutateDocument((draft) => {
        draft.clearCellOutputs(cellId)
        draft.setExecutionCount(cellId, null)
      })

      try {
        const finalStatus = await session.executeCell(cell.source, {
          onExecutionCount: (count) => {
            mutateDocument((draft) => draft.setExecutionCount(cellId, count))
          },
          onClearOutput: (wait) => {
            if (wait) {
              pendingClearWaitRef.current[cellId] = true
              return
            }
            pendingOutputsRef.current[cellId] = []
            mutateDocument((draft) => draft.clearCellOutputs(cellId))
          },
          onOutput: (output) => {
            if (pendingClearWaitRef.current[cellId]) {
              pendingOutputsRef.current[cellId] = []
              pendingClearWaitRef.current[cellId] = false
            }
            const outputs = [...(pendingOutputsRef.current[cellId] ?? []), output]
            pendingOutputsRef.current[cellId] = outputs
            mutateDocument((draft) => draft.setCellOutputs(cellId, outputs))
          }
        })
        setCellStates((current) => ({ ...current, [cellId]: finalStatus === 'ok' ? 'done' : 'failed' }))
        return finalStatus
      } catch (executeError) {
        setError(executeError instanceof Error ? executeError.message : String(executeError))
        setCellStates((current) => ({ ...current, [cellId]: 'failed' }))
        return 'error'
      } finally {
        setState(session.status === 'dead' ? 'error' : 'ready')
      }
    },
    [ensureKernel, mutateDocument, options.agentRunning]
  )

  const runCell = useCallback(
    async (cellId: string) => {
      await executeCell(cellId)
    },
    [executeCell]
  )

  const runAll = useCallback(async () => {
    if (options.agentRunning) {
      return
    }
    const cells = docRef.current?.document.cells.filter((cell) => cell.type === 'code') ?? []
    setCellStates((current) => {
      const next = { ...current }
      for (const cell of cells) {
        next[cell.id] = 'queued'
      }
      return next
    })
    for (const cell of cells) {
      if (sessionRef.current?.status === 'dead') {
        setState('error')
        break
      }
      const result = await executeCell(cell.id)
      if (result === 'error' && sessionRef.current === null) {
        // Kernel never connected (env missing / start failed); pointless to
        // retry the remaining cells.
        break
      }
    }
    setCellStates((current) => {
      if (!Object.values(current).some((cellState) => cellState === 'queued')) {
        return current
      }
      const next: typeof current = {}
      for (const [id, cellState] of Object.entries(current)) {
        if (cellState !== 'queued') {
          next[id] = cellState
        }
      }
      return next
    })
  }, [executeCell, options.agentRunning])

  const interrupt = useCallback(async () => {
    if (options.agentRunning) {
      return
    }
    try {
      await sessionRef.current?.interrupt()
    } catch (interruptError) {
      setError(interruptError instanceof Error ? interruptError.message : String(interruptError))
    }
  }, [options.agentRunning])

  const restart = useCallback(async () => {
    if (options.agentRunning) {
      return
    }
    try {
      setKernelStatus('restarting')
      await sessionRef.current?.restart()
    } catch (restartError) {
      setError(restartError instanceof Error ? restartError.message : String(restartError))
      setState('error')
    }
  }, [options.agentRunning])

  useEffect(() => {
    const executing = state === 'connecting' || state === 'busy' || Object.values(cellStates).some((cellState) => cellState === 'queued' || cellState === 'running')
    options.onExecutingChange?.(executing)
  }, [cellStates, options, state])

  const dismissEnvMissing = useCallback(() => {
    if (state === 'env-missing') {
      setState('disconnected')
      setEnvStatus(null)
    }
  }, [state])

  const installIpykernel = useCallback(async () => {
    if (options.apiBaseUrl === undefined || !options.sessionId || installingIpykernel) {
      return
    }
    setInstallingIpykernel(true)
    setError(null)
    try {
      const response = await fetch(
        `${options.apiBaseUrl}/api/sessions/${encodeURIComponent(options.sessionId)}/jupyter/ipykernel`,
        { method: 'POST' }
      )
      if (!response.ok) {
        throw new Error((await readApiError(response)).message)
      }
      const body = (await response.json()) as JupyterInstallIpykernelResponse
      if (!body.ok) {
        setEnvStatus(body.python)
        throw new Error('ipykernel is still missing after the install; check the server logs.')
      }
      // Ready to run again: clear the env-missing panel.
      setEnvStatus(null)
      setState('disconnected')
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : String(installError))
    } finally {
      setInstallingIpykernel(false)
    }
  }, [installingIpykernel, options.apiBaseUrl, options.sessionId])

  const reloadAfterConflict = useCallback(() => {
    setSaveState('idle')
    setSaveError(null)
    baselineRef.current = null
    options.onRequestReload?.()
    void refreshBaseline().catch(() => undefined)
  }, [options, refreshBaseline])

  const emptyDocument = useMemo(() => ({ cells: [], languageName: 'python' }), [])

  return {
    document: doc?.document ?? emptyDocument,
    parseError,
    version,
    executionCapable,
    state,
    kernelStatus,
    envStatus,
    error,
    cellStates,
    saveState,
    saveError,
    installingIpykernel,
    runCell,
    runAll,
    interrupt,
    restart,
    dismissEnvMissing,
    installIpykernel,
    reloadAfterConflict
  }
}
