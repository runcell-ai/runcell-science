import { CircleDot, FileDiff, PanelRightOpen, Square } from 'lucide-react'

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
  path?: string
  artifactCount?: number
  showDiffButton?: boolean
  diffButtonDisabled?: boolean
  onOpenDiff?: () => void
  onOpenArtifacts?: () => void
  onInterrupt: () => void
}

function AgentConversationHeader({
  title,
  providerLabel,
  status,
  connectionStatus,
  running,
  path,
  artifactCount = 0,
  showDiffButton = false,
  diffButtonDisabled = false,
  onOpenDiff,
  onOpenArtifacts,
  onInterrupt
}: AgentConversationHeaderProps) {
  return (
    <div className="conversation-header">
      <div className="conversation-title-group">
        <h1 className="conversation-title">{title}</h1>
        <div className="conversation-meta">
          <span className="conversation-provider">{providerLabel}</span>
          <StatusPill status={status} />
          {connectionStatus ? (
            <span className={`connection-dot connection-${connectionStatus}`}>
              <CircleDot />
              {connectionStatus === 'live'
                ? 'Live'
                : statusLabel(connectionStatus)}
            </span>
          ) : null}
          {path ? (
            <span className="conversation-path" title={path}>
              {path}
            </span>
          ) : null}
        </div>
      </div>

      <div className="conversation-actions">
        {onOpenArtifacts ? (
          <Button variant="outline" size="sm" onClick={onOpenArtifacts}>
            <PanelRightOpen />
            Artifacts
            {artifactCount > 0 ? (
              <span className="conversation-artifact-count">{artifactCount}</span>
            ) : null}
          </Button>
        ) : null}

        {showDiffButton ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenDiff}
            disabled={diffButtonDisabled || !onOpenDiff}
          >
            <FileDiff />
            Changes
          </Button>
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
