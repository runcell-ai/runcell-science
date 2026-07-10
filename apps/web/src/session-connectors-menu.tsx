import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentProvider, BundledScienceConnectorView, McpServerView } from '@runcell-science/contracts'
import { Button, providerLabel } from '@runcell-science/ui'
import { api, toErrorMessage } from './lib/api'

type SessionConnectorsMenuProps = {
  sessionId: string
  provider: AgentProvider
  cwd: string
  disabledServers: string[]
  running: boolean
}

export function SessionConnectorsMenu({ sessionId, provider, cwd, disabledServers, running }: SessionConnectorsMenuProps) {
  const [open, setOpen] = useState(false)
  const [servers, setServers] = useState<McpServerView[]>([])
  const [bundled, setBundled] = useState<BundledScienceConnectorView[]>([])
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
      const [response, bundledResponse] = await Promise.all([
        api.listMcpServers({ cwd }),
        api.listBundledConnectors({ cwd })
      ])
      setServers(response.servers.filter((server) => server.provider === provider && server.enabled))
      setBundled(bundledResponse.connectors.filter((connector) => connector.enabled))
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
    if (running) {
      setOpen(false)
    }
  }, [running])

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

  const configuredItems = servers.map((server) => ({
    key: server.key,
    name: server.name,
    label: server.name,
    scope: server.scope
  }))
  const bundledItems = bundled.map((connector) => ({
    key: connector.id,
    name: connector.name,
    label: connector.displayName,
    scope: connector.scope
  }))
  const items = [...bundledItems, ...configuredItems]
  const activeCount = items.filter((item) => !disabled.includes(item.name)).length

  return (
    <div className="session-connectors" ref={containerRef}>
      <Button size="sm" variant="outline" disabled={running} onClick={() => setOpen((v) => !v)}>
        Connectors{items.length > 0 ? ` ${activeCount}/${items.length}` : ''}
      </Button>
      {open ? (
        <div className="session-connectors-menu">
          <p className="session-connectors-hint">
            Enabled for this session only.
            {provider === 'codex' ? ' Changes apply from the next turn.' : ''}
          </p>
          {error ? <p className="connectors-error">{error}</p> : null}
          {loading ? <p className="connectors-empty">Loading…</p> : null}
          {!loading && items.length === 0 ? (
            <p className="connectors-empty">No {providerLabel(provider)} connectors configured.</p>
          ) : null}
          {items.map((item) => (
            <label key={item.key} className="session-connectors-item">
              <input
                type="checkbox"
                checked={!disabled.includes(item.name)}
                onChange={() => void toggleServer(item.name)}
              />
              <span className="session-connectors-name">{item.label}</span>
              <span className="session-connectors-scope">{item.scope}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  )
}
