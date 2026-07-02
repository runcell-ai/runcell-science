import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentProvider, McpServerView } from '@open-science/contracts'
import { Button } from '@open-science/ui'
import { api, toErrorMessage } from './lib/api'

type SessionConnectorsMenuProps = {
  sessionId: string
  provider: AgentProvider
  cwd: string
  disabledServers: string[]
}

export function SessionConnectorsMenu({ sessionId, provider, cwd, disabledServers }: SessionConnectorsMenuProps) {
  const [open, setOpen] = useState(false)
  const [servers, setServers] = useState<McpServerView[]>([])
  const [disabled, setDisabled] = useState<string[]>(disabledServers)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setDisabled(disabledServers)
  }, [sessionId, disabledServers])

  const loadServers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.listMcpServers({ cwd })
      setServers(response.servers.filter((server) => server.provider === provider && server.enabled))
    } catch (err) {
      setError(toErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [cwd, provider])

  useEffect(() => {
    if (open) {
      void loadServers()
    }
  }, [open, loadServers])

  useEffect(() => {
    if (!open) {
      return
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  const toggleServer = async (name: string) => {
    const next = disabled.includes(name) ? disabled.filter((entry) => entry !== name) : [...disabled, name]
    const previous = disabled
    setDisabled(next)
    setError(null)
    try {
      await api.updateSessionConnectors(sessionId, next)
    } catch (err) {
      setDisabled(previous)
      setError(toErrorMessage(err))
    }
  }

  const activeCount = servers.filter((server) => !disabled.includes(server.name)).length

  return (
    <div className="session-connectors" ref={containerRef}>
      <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
        Connectors{servers.length > 0 ? ` ${activeCount}/${servers.length}` : ''}
      </Button>
      {open ? (
        <div className="session-connectors-menu">
          <p className="session-connectors-hint">
            Enabled for this session only.
            {provider === 'codex' ? ' Changes apply from the next turn.' : ''}
          </p>
          {error ? <p className="connectors-error">{error}</p> : null}
          {loading ? <p className="connectors-empty">Loading…</p> : null}
          {!loading && servers.length === 0 ? (
            <p className="connectors-empty">No {provider === 'codex' ? 'Codex' : 'Claude Code'} connectors configured.</p>
          ) : null}
          {servers.map((server) => (
            <label key={server.key} className="session-connectors-item">
              <input
                type="checkbox"
                checked={!disabled.includes(server.name)}
                onChange={() => void toggleServer(server.name)}
              />
              <span className="session-connectors-name">{server.name}</span>
              <span className="session-connectors-scope">{server.scope}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  )
}
