import { ExternalLink, FileDiff, FileText, Globe2, Image as ImageIcon, Loader2 } from 'lucide-react'

import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import { AgentDiffView } from './agent-diff-view'
import { AgentActivityIcon, AgentMessageIcon } from './agent-icons'
import type { AgentRequestDecision, AgentTimelineItem } from './types'
import {
  compactText,
  eventSummary,
  eventTitle,
  statusLabel
} from './utils'
import { StatusPill } from './status-pill'

type AgentTimelineProps = {
  items: AgentTimelineItem[]
  running: boolean
  resolvingRequestId: string | null
  onResolveRequest: (
    request: Extract<AgentTimelineItem, { type: 'request' }>['request'],
    decision: AgentRequestDecision
  ) => void
  onOpenArtifact: (artifact: Extract<AgentTimelineItem, { type: 'artifact' }>['artifact']) => void
}

function AgentTimeline({
  items,
  running,
  resolvingRequestId,
  onResolveRequest,
  onOpenArtifact
}: AgentTimelineProps) {
  return (
    <ScrollArea className="chat-scroll">
      <div className="timeline-list">
        {items.length === 0 ? (
          <div className="chat-empty-state">No messages</div>
        ) : (
          items.map((item) => {
            if (item.type === 'message') {
              return <AgentMessageRow key={item.id} item={item} />
            }

            if (item.type === 'request') {
              return (
                <AgentRequestRow
                  key={item.id}
                  item={item}
                  resolvingRequestId={resolvingRequestId}
                  onResolveRequest={onResolveRequest}
                />
              )
            }

            if (item.type === 'diff') {
              return <AgentDiffRow key={item.id} item={item} />
            }

            if (item.type === 'artifact') {
              return <AgentArtifactRow key={item.id} item={item} onOpenArtifact={onOpenArtifact} />
            }

            return <AgentToolCallRow key={item.id} item={item} />
          })
        )}
        {running ? (
          <div className="running-row">
            <Loader2 />
            <span>Running</span>
          </div>
        ) : null}
      </div>
    </ScrollArea>
  )
}

function AgentMessageRow({
  item
}: {
  item: Extract<AgentTimelineItem, { type: 'message' }>
}) {
  return (
    <article className={`timeline-row message-row message-${item.message.role}`}>
      <div className="message-avatar">
        <AgentMessageIcon role={item.message.role} />
      </div>
      <div className="message-body">
        <div className="message-heading">
          <span>{item.message.role === 'assistant' ? 'Assistant' : 'User'}</span>
          <span>{statusLabel(item.message.status)}</span>
        </div>
        <p>{item.message.text}</p>
      </div>
    </article>
  )
}

function AgentRequestRow({
  item,
  resolvingRequestId,
  onResolveRequest
}: {
  item: Extract<AgentTimelineItem, { type: 'request' }>
  resolvingRequestId: string | null
  onResolveRequest: AgentTimelineProps['onResolveRequest']
}) {
  const isOpen = item.request.status === 'open'

  return (
    <article className={`timeline-row request-row request-${item.request.status}`}>
      <div className="activity-marker">
        <AgentActivityIcon status={item.request.status} />
      </div>
      <div className="request-card">
        <div className="request-copy">
          <span className="request-title">
            {item.request.title ?? item.request.type}
          </span>
          <StatusPill status={item.request.status} />
        </div>
        {isOpen ? (
          <div className="request-actions">
            <Button
              variant="outline"
              size="sm"
              disabled={resolvingRequestId === item.request.id}
              onClick={() => onResolveRequest(item.request, 'deny')}
            >
              Deny
            </Button>
            <Button
              className="primary-action"
              size="sm"
              disabled={resolvingRequestId === item.request.id}
              onClick={() => onResolveRequest(item.request, 'allow')}
            >
              Allow
            </Button>
          </div>
        ) : null}
      </div>
    </article>
  )
}

function AgentDiffRow({
  item
}: {
  item: Extract<AgentTimelineItem, { type: 'diff' }>
}) {
  return (
    <article className="timeline-row diff-row">
      <div className="activity-marker">
        <FileDiff className="activity-icon diff-activity-icon" />
      </div>
      <AgentDiffView diff={item.diff} />
    </article>
  )
}

function artifactTitle(item: Extract<AgentTimelineItem, { type: 'artifact' }>): string {
  return item.artifact.title ?? item.artifact.path ?? item.artifact.url ?? 'Artifact'
}

function artifactLabel(item: Extract<AgentTimelineItem, { type: 'artifact' }>): string {
  if (item.artifact.source === 'url') {
    return item.artifact.url
  }
  return item.artifact.path
}

function ArtifactIcon({ item }: { item: Extract<AgentTimelineItem, { type: 'artifact' }> }) {
  if (item.artifact.kind === 'url') {
    return <Globe2 className="activity-icon artifact-activity-icon" />
  }
  if (item.artifact.kind === 'image') {
    return <ImageIcon className="activity-icon artifact-activity-icon" />
  }
  return <FileText className="activity-icon artifact-activity-icon" />
}

function AgentArtifactRow({
  item,
  onOpenArtifact
}: {
  item: Extract<AgentTimelineItem, { type: 'artifact' }>
  onOpenArtifact: AgentTimelineProps['onOpenArtifact']
}) {
  return (
    <article className={`timeline-row artifact-row${item.active ? ' is-active' : ''}`}>
      <div className="activity-marker">
        <ArtifactIcon item={item} />
      </div>
      <div className="artifact-card">
        <div className="artifact-card-copy">
          <span className="artifact-card-title">{artifactTitle(item)}</span>
          <span className="artifact-card-path">{artifactLabel(item)}</span>
        </div>
        <Button type="button" variant={item.active ? 'secondary' : 'outline'} size="sm" onClick={() => onOpenArtifact(item.artifact)}>
          <ExternalLink />
          Preview
        </Button>
      </div>
    </article>
  )
}

function AgentToolCallRow({
  item
}: {
  item: Extract<AgentTimelineItem, { type: 'activity' }>
}) {
  const summary = eventSummary(item.event)

  return (
    <article className="timeline-row activity-row">
      <div className="activity-marker">
        <AgentActivityIcon status={item.event.status} />
      </div>
      <div className="activity-body">
        <div className="activity-title-row">
          <span>{eventTitle(item.event)}</span>
          {item.event.status ? <StatusPill status={item.event.status} /> : null}
        </div>
        {summary ? <p>{compactText(summary, 220)}</p> : null}
      </div>
    </article>
  )
}

export { AgentTimeline }
