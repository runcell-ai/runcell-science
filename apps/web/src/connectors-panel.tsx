import { useCallback, useEffect, useState } from 'react'
import type { ListMcpServersResponse, McpServerView } from '@open-science/contracts'
import {
  Button,
  ScrollArea,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@open-science/ui'
import { api, toErrorMessage } from './lib/api'

type ConnectorsPanelProps = {
  open: boolean
  cwd: string | null
  onOpenChange: (open: boolean) => void
}

const statusLabels: Record<McpServerView['status'], string> = {
  connected: 'Connected',
  failed: 'Failed',
  needs_auth: 'Needs auth',
  pending: 'Starting',
  disabled: 'Disabled',
  unknown: 'Not checked'
}

function connectorTarget(server: McpServerView): string {
  if (server.url) {
    return server.url
  }
  if (server.command) {
    return [server.command, ...server.args].join(' ')
  }
  return ''
}

export function ConnectorsPanel({ open, cwd, onOpenChange }: ConnectorsPanelProps) {
  const [data, setData] = useState<ListMcpServersResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (refresh: boolean) => {
      setLoading(true)
      setError(null)
      try {
        const response = await api.listMcpServers({ cwd: cwd ?? undefined, refresh })
        setData(response)
      } catch (err) {
        setError(toErrorMessage(err))
      } finally {
        setLoading(false)
      }
    },
    [cwd]
  )

  useEffect(() => {
    if (open) {
      void load(false)
    }
  }, [open, load])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="connectors-sheet">
        <SheetHeader>
          <SheetTitle>Connectors</SheetTitle>
          <SheetDescription>
            MCP servers configured for Codex and Claude Code. Changes made from their CLIs show up here too.
          </SheetDescription>
        </SheetHeader>

        <div className="connectors-toolbar">
          <Button size="sm" variant="outline" disabled={loading} onClick={() => void load(true)}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>

        {error ? <p className="connectors-error">{error}</p> : null}
        {data?.warnings.map((warning) => (
          <p key={warning} className="connectors-warning">
            {warning}
          </p>
        ))}

        <ScrollArea className="connectors-list">
          {data && data.servers.length === 0 && !loading ? (
            <p className="connectors-empty">No MCP servers configured yet.</p>
          ) : null}
          {data?.servers.map((server) => (
            <div key={server.key} className="connector-row">
              <div className="connector-row-main">
                <span className="connector-name">{server.name}</span>
                <span className={`connector-status connector-status-${server.status}`}>
                  {statusLabels[server.status]}
                </span>
              </div>
              <div className="connector-row-meta">
                <span className="connector-chip">{server.provider === 'codex' ? 'Codex' : 'Claude Code'}</span>
                <span className="connector-chip">{server.scope}</span>
                <span className="connector-chip">{server.transport}</span>
                {server.tools.length > 0 ? <span className="connector-chip">{server.tools.length} tools</span> : null}
              </div>
              {connectorTarget(server) ? <p className="connector-target">{connectorTarget(server)}</p> : null}
              {server.statusDetail ? <p className="connector-detail">{server.statusDetail}</p> : null}
            </div>
          ))}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
