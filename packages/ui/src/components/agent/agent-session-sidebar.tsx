import type { AgentSessionSummary } from '@open-science/contracts'
import { Plus, RefreshCw } from 'lucide-react'

import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '../ui/tooltip'
import { StatusPill } from './status-pill'
import { displaySessionTitle, providerLabel } from './utils'

type AgentSessionSidebarProps = {
  sessions: AgentSessionSummary[]
  activeSessionId: string | null
  onRefresh: () => void
  onStartDraft: () => void
  onOpenSession: (sessionId: string) => void
}

function AgentSessionSidebar({
  sessions,
  activeSessionId,
  onRefresh,
  onStartDraft,
  onOpenSession
}: AgentSessionSidebarProps) {
  return (
    <>
      <div className="panel-heading-row">
        <h2 className="panel-title">Sessions</h2>
        <div className="panel-actions">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon-sm" onClick={onRefresh}>
                <RefreshCw />
                <span className="sr-only">Refresh sessions</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh sessions</TooltipContent>
          </Tooltip>
          <Button className="primary-action" onClick={onStartDraft}>
            <Plus />
            New
          </Button>
        </div>
      </div>

      <ScrollArea className="panel-scroll">
        <div className="session-list">
          {sessions.length === 0 ? (
            <div className="panel-empty-state">No sessions</div>
          ) : (
            sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                className={`session-item ${session.id === activeSessionId ? 'is-active' : ''}`}
                onClick={() => onOpenSession(session.id)}
              >
                <span className="session-title">
                  {displaySessionTitle(session)}
                </span>
                <span className="session-meta">
                  <span>{providerLabel(session.provider)}</span>
                  <StatusPill status={session.status} />
                </span>
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </>
  )
}

export { AgentSessionSidebar }
