import { CircleDot, FileDiff, Square } from 'lucide-react'

import { Button } from '../ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '../ui/tooltip'
import type { AgentConnectionStatus } from './types'
import { StatusPill } from './status-pill'
import { statusLabel } from './utils'

type AgentConversationHeaderProps = {
  title: string
  providerLabel: string
  status: string
  connectionStatus: AgentConnectionStatus | null
  running: boolean
  showDiffButton?: boolean
  diffButtonDisabled?: boolean
  onOpenDiff?: () => void
  onInterrupt: () => void
}

function AgentConversationHeader({
  title,
  providerLabel,
  status,
  connectionStatus,
  running,
  showDiffButton = false,
  diffButtonDisabled = false,
  onOpenDiff,
  onInterrupt
}: AgentConversationHeaderProps) {
  return (
    <div className="conversation-header">
      <div className="conversation-title-group">
        <h1 className="conversation-title">{title}</h1>
        <div className="conversation-meta">
          {providerLabel}
          <StatusPill status={status} />
          {connectionStatus ? (
            <span className={`connection-dot connection-${connectionStatus}`}>
              <CircleDot />
              {connectionStatus === 'live'
                ? 'Live'
                : statusLabel(connectionStatus)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="conversation-actions">
        {showDiffButton ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={onOpenDiff}
                  disabled={diffButtonDisabled || !onOpenDiff}
                >
                  <FileDiff />
                  <span className="sr-only">Open project diff</span>
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>Open project diff</TooltipContent>
          </Tooltip>
        ) : null}

        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={onInterrupt}
                disabled={!running}
              >
                <Square />
                <span className="sr-only">Interrupt turn</span>
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Interrupt turn</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

export { AgentConversationHeader }
