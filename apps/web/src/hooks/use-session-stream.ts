import { useEffect, useRef, useState } from 'react'
import type { AgentSession, RuntimeSseEvent } from '@runcell-science/contracts'
import { api } from '../lib/api'
import { runtimeEventTypes } from '../lib/session-events'

export type ConnectionStatus = 'idle' | 'connecting' | 'live' | 'error'

export interface SessionStreamHandlers {
  onEvent: (event: RuntimeSseEvent) => void
  onSessionUpdated: (session: AgentSession) => void
  onTurnFinished: () => void
}

/**
 * Subscribes to a session's SSE stream and reports connection health.
 * Handlers are kept in a ref so callers can pass fresh closures every render
 * without tearing down the EventSource.
 */
export function useSessionStream(sessionId: string | null, handlers: SessionStreamHandlers): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>('idle')
  const handlersRef = useRef(handlers)

  useEffect(() => {
    handlersRef.current = handlers
  })

  useEffect(() => {
    if (!sessionId) {
      setStatus('idle')
      return
    }

    setStatus('connecting')
    const source = new EventSource(api.sessionEventsUrl(sessionId))
    const handleEvent = (message: MessageEvent<string>) => {
      let event: RuntimeSseEvent
      try {
        event = JSON.parse(message.data) as RuntimeSseEvent
      } catch {
        return
      }

      const { onEvent, onSessionUpdated, onTurnFinished } = handlersRef.current
      onEvent(event)

      if (event.type === 'session.updated') {
        onSessionUpdated(event.session)
      } else if (event.type === 'turn.completed' || event.type === 'turn.failed' || event.type === 'turn.interrupted') {
        onTurnFinished()
      }
    }

    runtimeEventTypes.forEach((type) => source.addEventListener(type, handleEvent as EventListener))
    source.onopen = () => setStatus('live')
    source.onerror = () => setStatus('error')

    return () => {
      runtimeEventTypes.forEach((type) => source.removeEventListener(type, handleEvent as EventListener))
      source.close()
    }
  }, [sessionId])

  return status
}
