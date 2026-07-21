import { type ReactNode, useEffect, useRef, useState } from 'react'
import { ExternalLink, FileText, Globe2, Image as ImageIcon, Loader2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { ScrollArea } from '../ui/scroll-area'
import { AgentDiffView } from './agent-diff-view'
import { AgentActivityIcon } from './agent-icons'
import type { AgentRequestResolution, AgentTimelineItem } from './types'
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
    resolution: AgentRequestResolution
  ) => void
  onOpenArtifact: (artifact: Extract<AgentTimelineItem, { type: 'artifact' }>['artifact']) => void
  renderNotebookExecution?: (item: Extract<AgentTimelineItem, { type: 'notebook-execution' }>) => ReactNode
}

function AgentTimeline({
  items,
  running,
  resolvingRequestId,
  onResolveRequest,
  onOpenArtifact,
  renderNotebookExecution
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

            if (item.type === 'notebook-execution') {
              return (
                <AgentNotebookExecutionRow
                  key={item.id}
                  item={item}
                  renderNotebookExecution={renderNotebookExecution}
                />
              )
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
  const { message } = item
  const isAssistant = message.role === 'assistant'
  const phaseClass = message.phase ? ` message-phase-${message.phase}` : ''
  const time = formatTimeOfDay(message.createdAt)
  return (
    <article className={`timeline-row message-row message-${message.role}${phaseClass}`}>
      <div className="message-body">
        <span className="sr-only">{isAssistant ? 'Assistant:' : 'You:'}</span>
        {isAssistant ? (
          <div className="message-markdown">
            <ReactMarkdown>{message.text}</ReactMarkdown>
          </div>
        ) : (
          <p>{message.text}</p>
        )}
      </div>
      {time ? (
        <span className="message-time" aria-hidden="true">
          {time}
        </span>
      ) : null}
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
  const questions = parseRequestQuestions(item.request)
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string[]>>({})
  const [customAnswers, setCustomAnswers] = useState<Record<number, string>>({})

  const resolvedAnswers = questions?.map((question, index) => {
    const selected = selectedAnswers[index] ?? []
    const custom = customAnswers[index]?.trim()
    return custom ? (question.multiple ? [...selected, custom] : [custom]) : selected
  })
  const canSubmitAnswers = resolvedAnswers?.every((answers) => answers.length > 0) ?? false

  function selectOption(questionIndex: number, label: string, multiple: boolean): void {
    if (!multiple) {
      setCustomAnswers((current) => ({ ...current, [questionIndex]: '' }))
    }
    setSelectedAnswers((current) => {
      const selected = current[questionIndex] ?? []
      const next = multiple
        ? selected.includes(label)
          ? selected.filter((entry) => entry !== label)
          : [...selected, label]
        : [label]
      return { ...current, [questionIndex]: next }
    })
  }

  return (
    <article className={`timeline-row request-row request-${item.request.status}`}>
      <div className="request-card">
        <div className="request-heading">
          <span className="request-eyebrow">
            {questions ? (isOpen ? 'Input required' : 'Input request') : isOpen ? 'Approval required' : 'Approval request'}
          </span>
          <StatusPill status={item.request.status} />
        </div>
        <span className="request-title">
          {item.request.title ?? item.request.type}
        </span>
        {isOpen && questions ? (
          <>
            <div className="request-questions">
              {questions.map((question, questionIndex) => (
                <fieldset className="request-question" key={`${question.header}:${questionIndex}`}>
                  <legend>{question.header}</legend>
                  <p>{question.question}</p>
                  {question.options.length > 0 ? (
                    <div className="request-options">
                      {question.options.map((option) => {
                        const checked = (selectedAnswers[questionIndex] ?? []).includes(option.label)
                        return (
                          <label className="request-option" key={option.label}>
                            <input
                              type={question.multiple ? 'checkbox' : 'radio'}
                              name={`request-${item.request.id}-${questionIndex}`}
                              checked={checked}
                              onChange={() => selectOption(questionIndex, option.label, question.multiple)}
                            />
                            <span>
                              <strong>{option.label}</strong>
                              {option.description ? <small>{option.description}</small> : null}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  ) : null}
                  {question.custom ? (
                    <Input
                      value={customAnswers[questionIndex] ?? ''}
                      placeholder="Type an answer"
                      aria-label={`${question.header} custom answer`}
                      onChange={(event) => {
                        const value = event.target.value
                        setCustomAnswers((current) => ({ ...current, [questionIndex]: value }))
                        if (!question.multiple && value.trim()) {
                          setSelectedAnswers((current) => ({ ...current, [questionIndex]: [] }))
                        }
                      }}
                    />
                  ) : null}
                </fieldset>
              ))}
            </div>
            <div className="request-actions">
              <Button
                variant="outline"
                size="sm"
                disabled={resolvingRequestId === item.request.id}
                onClick={() => onResolveRequest(item.request, { decision: 'deny' })}
              >
                Deny
              </Button>
              <Button
                size="sm"
                disabled={resolvingRequestId === item.request.id || !canSubmitAnswers}
                onClick={() =>
                  resolvedAnswers &&
                  onResolveRequest(item.request, { decision: 'answer', answers: resolvedAnswers })
                }
              >
                Submit answer
              </Button>
            </div>
          </>
        ) : isOpen ? (
          <div className="request-actions">
            <Button
              variant="outline"
              size="sm"
              disabled={resolvingRequestId === item.request.id}
              onClick={() => onResolveRequest(item.request, { decision: 'deny' })}
            >
              Deny
            </Button>
            <Button
              size="sm"
              disabled={resolvingRequestId === item.request.id}
              onClick={() => onResolveRequest(item.request, { decision: 'allow' })}
            >
              Allow
            </Button>
          </div>
        ) : null}
      </div>
    </article>
  )
}

interface RequestQuestion {
  header: string
  question: string
  options: Array<{ label: string; description: string }>
  multiple: boolean
  custom: boolean
}

function parseRequestQuestions(
  request: Extract<AgentTimelineItem, { type: 'request' }>['request']
): RequestQuestion[] | null {
  if (request.type !== 'opencode.question' && request.type !== 'opencode.question-v2') return null
  try {
    const payload = JSON.parse(request.payloadJson) as { questions?: unknown }
    if (!Array.isArray(payload.questions) || payload.questions.length === 0) return null
    const questions: RequestQuestion[] = []
    for (const value of payload.questions) {
      if (!value || typeof value !== 'object') return null
      const record = value as Record<string, unknown>
      if (typeof record.header !== 'string' || typeof record.question !== 'string' || !Array.isArray(record.options)) {
        return null
      }
      const options: RequestQuestion['options'] = []
      for (const option of record.options) {
        if (!option || typeof option !== 'object') return null
        const optionRecord = option as Record<string, unknown>
        if (typeof optionRecord.label !== 'string' || typeof optionRecord.description !== 'string') return null
        options.push({ label: optionRecord.label, description: optionRecord.description })
      }
      questions.push({
        header: record.header,
        question: record.question,
        options,
        multiple: record.multiple === true,
        custom: record.custom === true
      })
    }
    return questions
  } catch {
    return null
  }
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

function AgentNotebookExecutionRow({
  item,
  renderNotebookExecution
}: {
  item: Extract<AgentTimelineItem, { type: 'notebook-execution' }>
  renderNotebookExecution: AgentTimelineProps['renderNotebookExecution']
}) {
  if (renderNotebookExecution) {
    return <>{renderNotebookExecution(item)}</>
  }

  return <AgentToolCallRow item={{ id: item.id, type: 'activity', createdAt: item.createdAt, event: item.event }} />
}

export { AgentTimeline }
