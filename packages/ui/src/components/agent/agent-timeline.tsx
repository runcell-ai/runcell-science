import { Loader2 } from 'lucide-react'

import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
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
}

function AgentTimeline({
  items,
  running,
  resolvingRequestId,
  onResolveRequest
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
