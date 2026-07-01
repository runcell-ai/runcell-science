import { CircleDot, Square } from 'lucide-react'

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
  onInterrupt: () => void
}

function AgentConversationHeader({
  title,
  providerLabel,
  status,
  connectionStatus,
  running,
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
  )
}

export { AgentConversationHeader }
