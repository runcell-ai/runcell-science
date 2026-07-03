import { Download, Loader2, Play, RefreshCw, RotateCcw, Square, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'
import type { JupyterPythonEnvStatus } from '@open-science/contracts'
import { Button } from '@open-science/ui'
import type { NotebookCell } from './nbformat'
import { OutputView } from './outputs'
import { useNotebookExecution } from './use-notebook-execution'
import type { NotebookCellExecutionState, NotebookExecutionState, NotebookSaveState } from './use-notebook-execution'

type NotebookViewerProps = {
  content: string
  apiBaseUrl?: string
  sessionId?: string
  filePath?: string
  running?: boolean
  onExecutingChange?: (executing: boolean) => void
  onRequestReload?: () => void
}

function stateLabel(state: NotebookExecutionState, kernelStatus: string): string {
  if (state === 'connecting') {
    return 'Connecting'
  }
  if (state === 'busy') {
    return 'Busy'
  }
  if (state === 'env-missing') {
    return 'Environment missing'
  }
  if (state === 'error') {
    return 'Error'
  }
  if (state === 'ready') {
    return kernelStatus === 'unknown' ? 'Ready' : kernelStatus
  }
  return 'Disconnected'
}

function SaveBanner({
  saveState,
  saveError,
  onReload
}: {
  saveState: NotebookSaveState
  saveError: string | null
  onReload: () => void
}) {
  if (saveState === 'conflict') {
    return (
      <div className="nb-banner nb-banner-warning">
        <span>{saveError ?? 'The notebook changed on disk.'}</span>
        <Button type="button" variant="outline" size="sm" onClick={onReload}>
          <RefreshCw />
          Reload
        </Button>
      </div>
    )
  }
  if (saveState === 'error') {
    return <div className="nb-banner nb-banner-warning">{saveError ?? 'Notebook outputs could not be saved.'}</div>
  }
  return null
}

function EnvMissingPanel({
  envStatus,
  installing,
  onInstall,
  onDismiss
}: {
  envStatus: JupyterPythonEnvStatus | null
  installing: boolean
  onInstall: () => void
  onDismiss: () => void
}) {
  const hasPython = Boolean(envStatus?.pythonPath)

  return (
    <div className="nb-env-panel">
      <div className="nb-env-copy">
        <strong>{hasPython ? 'ipykernel is missing' : 'No Python environment found'}</strong>
        <span>
          Python: <code>{envStatus?.pythonPath ?? 'not found'}</code>
        </span>
        <span>
          {hasPython
            ? 'Running notebooks needs the ipykernel package in this workspace environment.'
            : 'Create a .venv in this workspace (e.g. with uv) or install python3, then try again.'}
        </span>
      </div>
      <div className="nb-env-command">
        {hasPython ? (
          <Button type="button" variant="outline" size="sm" disabled={installing} onClick={onInstall}>
            {installing ? <Loader2 className="spin-icon" /> : <Download />}
            {installing ? 'Installing…' : 'Install ipykernel'}
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Dismiss" title="Dismiss" onClick={onDismiss}>
          <X />
        </Button>
      </div>
    </div>
  )
}

function NotebookToolbar({
  state,
  kernelStatus,
  disabled,
  onRunAll,
  onInterrupt,
  onRestart
}: {
  state: NotebookExecutionState
  kernelStatus: string
  disabled: boolean
  onRunAll: () => void
  onInterrupt: () => void
  onRestart: () => void
}) {
  const busy = state === 'connecting' || state === 'busy'
  return (
    <div className="nb-toolbar">
      <div className="nb-toolbar-actions">
        <Button type="button" variant="outline" size="sm" disabled={disabled || busy} onClick={onRunAll}>
          <Play />
          Run All
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={disabled || state === 'disconnected'} onClick={onInterrupt}>
          <Square />
          Interrupt
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={disabled || busy || state === 'disconnected'} onClick={onRestart}>
          <RotateCcw />
          Restart
        </Button>
      </div>
      <div className={`nb-kernel-status nb-kernel-${state}`}>
        <span className="nb-kernel-dot" />
        <span>{stateLabel(state, kernelStatus)}</span>
      </div>
    </div>
  )
}

function CellGutter({
  cell,
  cellState,
  disabled,
  onRun
}: {
  cell: NotebookCell
  cellState: NotebookCellExecutionState | undefined
  disabled: boolean
  onRun: () => void
}) {
  if (cell.type !== 'code') {
    return <span className="nb-exec-count" />
  }
  const running = cellState === 'queued' || cellState === 'running'
  return (
    <div className="nb-code-gutter">
      <button type="button" className="nb-run-cell" title="Run cell" disabled={disabled || running} onClick={onRun}>
        {running ? <Loader2 className="spin-icon" /> : <Play />}
      </button>
      <span className="nb-exec-count">[{running ? '*' : cell.executionCount ?? ' '}]</span>
    </div>
  )
}

export default function NotebookViewer({
  content,
  apiBaseUrl,
  sessionId,
  filePath,
  running = false,
  onExecutingChange,
  onRequestReload
}: NotebookViewerProps) {
  const notebook = useNotebookExecution({
    content,
    apiBaseUrl,
    sessionId,
    filePath,
    agentRunning: running,
    onExecutingChange,
    onRequestReload
  })
  const disabled = running || notebook.state === 'connecting'

  if (notebook.parseError) {
    return (
      <div className="nb-root">
        <div className="nb-parse-error">Couldn’t render this notebook: {notebook.parseError}</div>
        <pre className="preview-text">{content.slice(0, 50_000)}</pre>
      </div>
    )
  }

  if (notebook.document.cells.length === 0) {
    return <div className="side-panel-empty">This notebook has no cells.</div>
  }

  return (
    <div className="nb-root">
      {notebook.executionCapable ? (
        <>
          <NotebookToolbar
            state={notebook.state}
            kernelStatus={notebook.kernelStatus}
            disabled={running}
            onRunAll={() => void notebook.runAll()}
            onInterrupt={() => void notebook.interrupt()}
            onRestart={() => void notebook.restart()}
          />
          {running ? <div className="nb-banner">Agent is running — notebook is read-only until the turn ends.</div> : null}
          {notebook.state === 'env-missing' ? (
            <EnvMissingPanel
              envStatus={notebook.envStatus}
              installing={notebook.installingIpykernel}
              onInstall={() => void notebook.installIpykernel()}
              onDismiss={notebook.dismissEnvMissing}
            />
          ) : null}
          {notebook.error && notebook.state === 'error' ? <div className="nb-banner nb-banner-warning">{notebook.error}</div> : null}
          <SaveBanner saveState={notebook.saveState} saveError={notebook.saveError} onReload={notebook.reloadAfterConflict} />
        </>
      ) : null}

      {notebook.document.cells.map((cell) =>
        cell.type === 'markdown' ? (
          <section key={cell.id} className="nb-cell nb-cell-markdown">
            <article className="artifact-markdown nb-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                {cell.source}
              </ReactMarkdown>
            </article>
          </section>
        ) : (
          <section key={cell.id} className={`nb-cell nb-cell-${cell.type}`}>
            <div className="nb-source-row">
              {notebook.executionCapable ? (
                <CellGutter
                  cell={cell}
                  cellState={notebook.cellStates[cell.id]}
                  disabled={disabled || cell.type !== 'code'}
                  onRun={() => void notebook.runCell(cell.id)}
                />
              ) : (
                <span className="nb-exec-count">
                  {cell.type === 'code' ? `[${cell.executionCount ?? ' '}]` : ''}
                </span>
              )}
              <pre className="nb-source">{cell.source}</pre>
            </div>
            {cell.outputs.length > 0 ? (
              <div className="nb-outputs">
                {cell.outputs.map((output, index) => (
                  <OutputView key={index} output={output} />
                ))}
              </div>
            ) : null}
          </section>
        )
      )}
    </div>
  )
}
