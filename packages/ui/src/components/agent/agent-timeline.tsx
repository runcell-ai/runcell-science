import { useEffect, useRef } from 'react'
import { ExternalLink, FileText, Globe2, Image as ImageIcon, Loader2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import { AgentDiffView } from './agent-diff-view'
import { AgentActivityIcon } from './agent-icons'
import type { AgentRequestDecision, AgentTimelineItem } from './types'
import {
  compactText,
  eventSummary,
  eventTitle,
  formatTimeOfDay
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
  const endRef = useRef<HTMLDivElement | null>(null)
  const pinnedRef = useRef(true)

  useEffect(() => {
    const viewport = endRef.current?.closest('[data-slot="scroll-area-viewport"]')
    if (!(viewport instanceof HTMLElement)) {
      return
    }

    const trackPinned = () => {
      pinnedRef.current =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80
    }
    viewport.addEventListener('scroll', trackPinned, { passive: true })
    return () => viewport.removeEventListener('scroll', trackPinned)
  }, [])

  useEffect(() => {
    const viewport = endRef.current?.closest('[data-slot="scroll-area-viewport"]')
    if (viewport instanceof HTMLElement && pinnedRef.current) {
      viewport.scrollTop = viewport.scrollHeight
    }
  }, [items, running])

  return (
    <ScrollArea className="chat-scroll">
      <div className="timeline-list">
        {items.length === 0 ? (
          <div className="chat-empty-state">
            No activity yet. Send a prompt below to start the session.
          </div>
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
            <span>Working</span>
          </div>
        ) : null}
        <div ref={endRef} aria-hidden="true" />
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
      <div className="message-body">
        <div className="message-meta">
          <span className="message-role">
            {item.message.role === 'assistant' ? 'Assistant' : 'You'}
          </span>
          <span className="message-time">{formatTimeOfDay(item.message.createdAt)}</span>
        </div>
        {item.message.role === 'assistant' ? (
          <div className="message-markdown">
            <ReactMarkdown>{item.message.text}</ReactMarkdown>
          </div>
        ) : (
          <p>{item.message.text}</p>
        )}
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
      <div className="request-card">
        <div className="request-heading">
          <span className="request-eyebrow">
            {isOpen ? 'Approval required' : 'Approval request'}
          </span>
          <StatusPill status={item.request.status} />
        </div>
        <span className="request-title">
          {item.request.title ?? item.request.type}
        </span>
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
    return <Globe2 />
  }
  if (item.artifact.kind === 'image') {
    return <ImageIcon />
  }
  return <FileText />
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
      <div className="artifact-card">
        <div className="artifact-card-icon">
          <ArtifactIcon item={item} />
        </div>
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
      <AgentActivityIcon status={item.event.status} />
      <div className="activity-body">
        <div className="activity-title-row">
          <span className="activity-title">{eventTitle(item.event)}</span>
          <span className="activity-time">{formatTimeOfDay(item.event.createdAt)}</span>
        </div>
        {summary ? <p>{compactText(summary, 220)}</p> : null}
      </div>
    </article>
  )
}

export { AgentTimeline }
