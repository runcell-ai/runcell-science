import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentSession, AgentSessionSummary } from '@runcell-science/contracts'
import { api, toErrorMessage } from '../lib/api'
import { upsertSessionSummary } from '../lib/session-events'

export function useSessionList(onError: (message: string) => void) {
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([])
  const onErrorRef = useRef(onError)

  useEffect(() => {
    onErrorRef.current = onError
  })

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    try {
      const response = await api.listSessions()
      setSessions(response.sessions)
    } catch (error) {
      if (!options?.silent) {
        onErrorRef.current(toErrorMessage(error))
      }
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const upsert = useCallback((session: AgentSession) => {
    setSessions((items) => upsertSessionSummary(items, session))
  }, [])

  return { sessions, refresh, upsert }
}
