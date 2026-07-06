import { useCallback, useEffect, useState } from 'react'
import type {
  AgentProvider,
  BundledScienceConnectorView,
  ListBundledScienceConnectorsResponse,
  ListMcpServersResponse,
  McpServerView
} from '@runcell-science/contracts'
import {
  Button,
  ScrollArea,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Textarea
} from '@runcell-science/ui'
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
  const [bundledData, setBundledData] = useState<ListBundledScienceConnectorsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [importOpen, setImportOpen] = useState(false)
  const [importJson, setImportJson] = useState('')
  const [importTargets, setImportTargets] = useState<AgentProvider[]>(['codex', 'claude'])
  const [importing, setImporting] = useState(false)

  const load = useCallback(
    async (refresh: boolean) => {
      setLoading(true)
      setError(null)
      try {
        const [mcpResponse, bundledResponse] = await Promise.all([
          api.listMcpServers({ cwd: cwd ?? undefined, refresh }),
          cwd ? api.listBundledConnectors({ cwd }) : Promise.resolve<ListBundledScienceConnectorsResponse>({ connectors: [] })
        ])
        setData(mcpResponse)
        setBundledData(bundledResponse)
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
      setNotice(null)
      void load(false)
    }
  }, [open, load])

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusyKey(key)
    setError(null)
    setNotice(null)
    try {
      await action()
      await load(false)
    } catch (err) {
      setError(toErrorMessage(err))
    } finally {
      setBusyKey(null)
    }
  }

  const removeServer = (server: McpServerView) =>
    runAction(server.key, async () => {
      await api.removeMcpServer({
        provider: server.provider,
        scope: server.scope,
        name: server.name,
        ...(cwd ? { cwd } : {})
      })
      setNotice(`Removed ${server.name}.`)
    })

  const toggleServer = (server: McpServerView) =>
    runAction(server.key, async () => {
      await api.setMcpServerEnabled(server.provider, server.name, !server.enabled)
      setNotice(`${server.enabled ? 'Disabled' : 'Enabled'} ${server.name}.`)
    })

  const toggleBundledConnector = (connector: BundledScienceConnectorView) =>
    runAction(`bundled:${connector.name}`, async () => {
      if (!cwd) {
        throw new Error('Open a project before enabling bundled connectors.')
      }
      await api.setBundledConnectorEnabled(connector.name, cwd, !connector.enabled)
      setNotice(`${connector.enabled ? 'Disabled' : 'Enabled'} ${connector.displayName}.`)
    })

  const loginServer = (server: McpServerView) =>
    runAction(server.key, async () => {
      const { authorizationUrl } = await api.mcpOauthLogin(server.provider, server.name)
      window.open(authorizationUrl, '_blank', 'noopener')
      setNotice(`Opened authorization page for ${server.name}. Refresh after completing login.`)
    })

  const toggleImportTarget = (provider: AgentProvider) => {
    setImportTargets((current) =>
      current.includes(provider) ? current.filter((p) => p !== provider) : [...current, provider]
    )
  }

  const submitImport = async () => {
    setImporting(true)
    setError(null)
    setNotice(null)
    try {
      const result = await api.importMcpServers({ json: importJson, providers: importTargets })
      const parts: string[] = []
      if (result.added.length > 0) parts.push(`added ${result.added.join(', ')}`)
      if (result.skipped.length > 0) parts.push(`skipped existing ${result.skipped.join(', ')}`)
      if (result.errors.length > 0) parts.push(`errors: ${result.errors.join('; ')}`)
      setNotice(`Import finished: ${parts.join(' · ') || 'nothing to do'}.`)
      if (result.added.length > 0) {
        setImportJson('')
        setImportOpen(false)
      }
      await load(false)
    } catch (err) {
      setError(toErrorMessage(err))
    } finally {
      setImporting(false)
    }
  }

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
          <Button size="sm" variant="outline" onClick={() => setImportOpen((v) => !v)}>
            {importOpen ? 'Close import' : 'Import JSON'}
          </Button>
          <Button size="sm" variant="outline" disabled={loading} onClick={() => void load(true)}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>

        {importOpen ? (
          <div className="connectors-import">
            <Textarea
              value={importJson}
              placeholder='Paste a {"mcpServers": {...}} snippet'
              rows={6}
              onChange={(event) => setImportJson(event.target.value)}
            />
            <div className="connectors-import-row">
              <label className="connectors-import-target">
                <input
                  type="checkbox"
                  checked={importTargets.includes('codex')}
                  onChange={() => toggleImportTarget('codex')}
                />
                Codex
              </label>
              <label className="connectors-import-target">
                <input
                  type="checkbox"
                  checked={importTargets.includes('claude')}
                  onChange={() => toggleImportTarget('claude')}
                />
                Claude Code
              </label>
              <Button
                size="sm"
                disabled={importing || importJson.trim().length === 0 || importTargets.length === 0}
                onClick={() => void submitImport()}
              >
                {importing ? 'Importing…' : 'Import'}
              </Button>
            </div>
          </div>
        ) : null}

        {error ? <p className="connectors-error">{error}</p> : null}
        {notice ? <p className="connectors-notice">{notice}</p> : null}
        {data?.warnings.map((warning) => (
          <p key={warning} className="connectors-warning">
            {warning}
          </p>
        ))}

        <ScrollArea className="connectors-list">
          <div className="connectors-section-label">Runcell Science science connectors</div>
          {bundledData && bundledData.connectors.length === 0 && !loading ? (
            <p className="connectors-empty">Open a project to enable bundled science connectors.</p>
          ) : null}
          {bundledData?.connectors.map((connector) => {
            const busy = busyKey === `bundled:${connector.name}`
            return (
              <div key={connector.id} className="connector-row">
                <div className="connector-row-main">
                  <span className="connector-name">{connector.displayName}</span>
                  <span className={`connector-status connector-status-${connector.enabled ? 'connected' : 'disabled'}`}>
                    {connector.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <div className="connector-row-meta">
                  <span className="connector-chip">Bundled</span>
                  <span className="connector-chip">{connector.batch}</span>
                  <span className="connector-chip">{connector.transport}</span>
                  <span className="connector-chip">{connector.toolCount} tools</span>
                </div>
                <p className="connector-target">{connector.description}</p>
                {connector.upstreams.length > 0 ? (
                  <p className="connector-detail">{connector.upstreams.map((upstream) => upstream.name).join(', ')}</p>
                ) : null}
                <div className="connector-actions">
                  <Button size="sm" variant="outline" disabled={busy || !cwd} onClick={() => void toggleBundledConnector(connector)}>
                    {busy ? 'Working…' : connector.enabled ? 'Disable' : 'Enable'}
                  </Button>
                </div>
              </div>
            )
          })}

          <div className="connectors-section-label">Configured MCP servers</div>
          {data && data.servers.length === 0 && !loading ? (
            <p className="connectors-empty">No MCP servers configured yet. Paste a JSON snippet to add one.</p>
          ) : null}
          {data?.servers.map((server) => {
            const busy = busyKey === server.key
            return (
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
                <div className="connector-actions">
                  {server.provider === 'codex' ? (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void toggleServer(server)}>
                      {server.enabled ? 'Disable' : 'Enable'}
                    </Button>
                  ) : null}
                  {server.provider === 'codex' && server.status === 'needs_auth' ? (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void loginServer(server)}>
                      Log in
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void removeServer(server)}>
                    {busy ? 'Working…' : 'Remove'}
                  </Button>
                </div>
              </div>
            )
          })}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
