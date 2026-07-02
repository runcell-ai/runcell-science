import { useMemo } from 'react'
import { FileDiff, Loader2, RefreshCw, X } from 'lucide-react'
import type { AgentSessionWorktreeDiffResponse } from '@open-science/contracts'
import { AgentDiffView, Button, ScrollArea } from '@open-science/ui'

type WorktreeDiffPanelProps = {
  diff: AgentSessionWorktreeDiffResponse | null
  loading: boolean
  path: string
  onRefresh: () => void
  onClose: () => void
}

function diffStats(unifiedDiff: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of unifiedDiff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      additions += 1
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      deletions += 1
    }
  }
  return { additions, deletions }
}

function WorktreeDiffPanel({
  diff,
  loading,
  path,
  onRefresh,
  onClose
}: WorktreeDiffPanelProps) {
  const unifiedDiff = diff?.unifiedDiff?.trim() ?? ''
  const stats = useMemo(
    () => (unifiedDiff ? diffStats(unifiedDiff) : null),
    [unifiedDiff]
  )

  return (
    <aside className="side-panel">
      <header className="side-panel-header">
        <div className="side-panel-title-group">
          <div className="side-panel-icon">
            <FileDiff />
          </div>
          <div className="side-panel-copy">
            <h2>
              Project changes
              {stats ? (
                <span className="diff-stats">
                  <span className="diff-stat-add">+{stats.additions}</span>
                  <span className="diff-stat-del">-{stats.deletions}</span>
                </span>
              ) : null}
            </h2>
            <span>{path}</span>
          </div>
        </div>
        <div className="side-panel-actions">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh changes"
            title="Refresh changes"
            disabled={loading}
            onClick={onRefresh}
          >
            <RefreshCw />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close changes"
            title="Close changes"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
      </header>

      <div className="side-panel-body">
        {loading && !unifiedDiff ? (
          <div className="side-panel-loading">
            <Loader2 className="spin-icon" />
            Reading working tree
          </div>
        ) : unifiedDiff ? (
          <ScrollArea className="diff-panel-scroll">
            <div className="diff-panel-content">
              <AgentDiffView title="Working tree" diff={{ files: [], unifiedDiff }} />
            </div>
          </ScrollArea>
        ) : (
          <div className="side-panel-empty">No uncommitted changes</div>
        )}
      </div>
    </aside>
  )
}

export { WorktreeDiffPanel }
