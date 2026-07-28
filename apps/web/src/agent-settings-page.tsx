import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AgentProviderLoginAttempt,
  AgentProviderLoginFlow,
  AgentProviderSetupInput,
  AgentProviderSnapshot,
  AgentProviderSnapshotResponse
} from '@runcell-science/contracts'
import { Button, Input } from '@runcell-science/ui'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  RefreshCw,
  Settings2,
  Terminal
} from 'lucide-react'

import { isLoginAttemptExpired, setupTestOutcome } from './lib/agent-settings-state'
import { api, ApiRequestError, toErrorMessage } from './lib/api'

type BuiltinInstanceId = 'grok' | 'codex' | 'claude'

interface ProviderMeta {
  instanceId: BuiltinInstanceId
  displayName: string
  description: string
}

interface SetupDraft {
  binaryPath: string
  configHome: string
}

const PROVIDERS: readonly ProviderMeta[] = [
  {
    instanceId: 'grok',
    displayName: 'Grok Build',
    description: 'xAI coding agent through the local Grok CLI.'
  },
  {
    instanceId: 'codex',
    displayName: 'CodeX',
    description: 'OpenAI coding agent through the local Codex app server.'
  },
  {
    instanceId: 'claude',
    displayName: 'Claude Code',
    description: 'Anthropic coding agent through the local Claude CLI.'
  }
]

const TERMINAL_ATTEMPT_STATUSES = new Set<AgentProviderLoginAttempt['status']>([
  'succeeded',
  'failed',
  'expired',
  'cancelled'
])
const LOGIN_POLL_INTERVAL_MS = 1_200
const LOGIN_POLL_REQUEST_TIMEOUT_MS = 10_000
const MAX_LOGIN_POLL_FAILURES = 3

function setupInput(draft: SetupDraft): AgentProviderSetupInput {
  return {
    binaryPathOverride: draft.binaryPath.trim() || null,
    configHomeOverride: draft.configHome.trim() || null
  }
}

function initialSetupDraft(snapshot: AgentProviderSnapshot): SetupDraft {
  return {
    binaryPath: snapshot.commandSource === 'persisted' ? snapshot.configuredCommand : '',
    configHome: snapshot.homeSource === 'persisted' ? (snapshot.configHome ?? '') : ''
  }
}

function availabilityLabel(snapshot: AgentProviderSnapshot | null): string {
  if (!snapshot) return 'Detecting…'
  if (snapshot.refreshState === 'refreshing' || snapshot.availability === 'checking') return 'Checking…'
  if (!snapshot.installed || snapshot.availability === 'not_installed') return 'Not installed'
  if (snapshot.auth.status === 'authenticated') return 'Signed in'
  if (snapshot.auth.status === 'unauthenticated' || snapshot.availability === 'needs_auth') {
    return 'Sign-in required'
  }
  if (snapshot.availability === 'error') return 'Needs attention'
  return 'Status unknown'
}

function statusTone(snapshot: AgentProviderSnapshot | null): string {
  if (!snapshot || snapshot.refreshState === 'refreshing' || snapshot.availability === 'checking') return 'checking'
  if (snapshot.auth.status === 'authenticated') return 'ready'
  if (!snapshot.installed || snapshot.availability === 'not_installed') return 'muted'
  if (snapshot.availability === 'error') return 'error'
  return 'warning'
}

function attemptLabel(status: AgentProviderLoginAttempt['status']): string {
  switch (status) {
    case 'starting':
      return 'Starting sign-in…'
    case 'awaiting_user':
      return 'Waiting for you'
    case 'succeeded':
      return 'Signed in'
    case 'failed':
      return 'Sign-in failed'
    case 'expired':
      return 'Sign-in expired'
    case 'cancelled':
      return 'Sign-in cancelled'
  }
}

function LoginFlowView({
  flow,
  onCopy
}: {
  flow: AgentProviderLoginFlow
  onCopy(value: string): void
}) {
  if (flow.kind === 'device_code') {
    return (
      <div className="agent-login-flow">
        <span>Open the verification page and enter this code:</span>
        <div className="agent-device-code-row">
          <code>{flow.userCode}</code>
          <Button variant="outline" size="sm" onClick={() => onCopy(flow.userCode)}>
            <Copy />
            Copy code
          </Button>
        </div>
        <a href={flow.verificationUrl} target="_blank" rel="noreferrer">
          Open verification page
          <ExternalLink />
        </a>
      </div>
    )
  }

  if (flow.kind === 'browser') {
    return (
      <div className="agent-login-flow">
        <span>Continue sign-in in your browser.</span>
        <a href={flow.url} target="_blank" rel="noreferrer">
          Open sign-in page
          <ExternalLink />
        </a>
      </div>
    )
  }

  if (flow.kind === 'manual') {
    return (
      <div className="agent-login-flow">
        <span>{flow.message}</span>
        <div className="agent-command-row">
          <code>{flow.command}</code>
          <Button variant="outline" size="sm" onClick={() => onCopy(flow.command)}>
            <Copy />
            Copy
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="agent-login-flow">
      <span>{flow.message}</span>
      <span className="agent-login-flow-hint">Complete the sign-in in the window opened by the local CLI.</span>
    </div>
  )
}

interface ProviderCardProps {
  meta: ProviderMeta
  snapshot: AgentProviderSnapshot | null
  attempt: AgentProviderLoginAttempt | null
  setupOpen: boolean
  draft: SetupDraft
  busyAction: string | null
  notice: string | null
  error: string | null
  onRefresh(): void
  onLogin(): void
  onCancelLogin(): void
  onToggleSetup(): void
  onDraftChange(field: keyof SetupDraft, value: string): void
  onTestSetup(): void
  onSaveSetup(): void
  onResetSetup(): void
  onCopy(value: string): void
}

function ProviderCard({
  meta,
  snapshot,
  attempt,
  setupOpen,
  draft,
  busyAction,
  notice,
  error,
  onRefresh,
  onLogin,
  onCancelLogin,
  onToggleSetup,
  onDraftChange,
  onTestSetup,
  onSaveSetup,
  onResetSetup,
  onCopy
}: ProviderCardProps) {
  const attemptActive = attempt ? !TERMINAL_ATTEMPT_STATUSES.has(attempt.status) : false
  const setupPanelId = `agent-provider-${meta.instanceId}-setup`
  const detectedPath = snapshot?.resolvedExecutablePath ?? ''
  const checkedAt = snapshot?.checkedAt
    ? new Date(snapshot.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <article className="agent-provider-card" data-testid={`agent-provider-${meta.instanceId}`}>
      <div className="agent-provider-card-header">
        <div className="agent-provider-identity">
          <div className={`agent-provider-icon agent-provider-icon-${meta.instanceId}`} aria-hidden="true">
            <Terminal />
          </div>
          <div>
            <h2>{meta.displayName}</h2>
            <p>{meta.description}</p>
          </div>
        </div>
        <span className={`agent-provider-status agent-provider-status-${statusTone(snapshot)}`}>
          <span aria-hidden="true" />
          {availabilityLabel(snapshot)}
        </span>
      </div>

      <div className="agent-provider-facts">
        <div>
          <span>Installation</span>
          <strong>{snapshot?.installed ? 'Detected' : snapshot ? 'Not found' : 'Checking'}</strong>
        </div>
        <div>
          <span>Login</span>
          <strong>{snapshot?.auth.label ?? availabilityLabel(snapshot)}</strong>
        </div>
        <div>
          <span>Version</span>
          <strong>{snapshot?.version ?? '—'}</strong>
        </div>
        <div>
          <span>Executable</span>
          <strong title={detectedPath || snapshot?.configuredCommand}>
            {detectedPath || snapshot?.configuredCommand || 'Detecting…'}
          </strong>
        </div>
      </div>

      {snapshot?.message ? <p className="agent-provider-message">{snapshot.message}</p> : null}
      {checkedAt ? <p className="agent-provider-checked">Last checked at {checkedAt}</p> : null}

      <div className="agent-provider-actions">
        <Button variant="outline" size="sm" disabled={!snapshot || busyAction !== null} onClick={onRefresh}>
          <RefreshCw className={busyAction === 'refresh' ? 'is-spinning' : undefined} />
          Refresh
        </Button>
        {snapshot?.installed && snapshot.capabilities.login ? (
          <Button
            size="sm"
            disabled={busyAction !== null || attemptActive}
            onClick={onLogin}
          >
            {snapshot.auth.status === 'authenticated' ? 'Sign in again' : 'Authorize'}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          disabled={!snapshot || busyAction !== null}
          aria-expanded={setupOpen}
          aria-controls={setupPanelId}
          onClick={onToggleSetup}
        >
          <Settings2 />
          Local setup
          {setupOpen ? <ChevronUp /> : <ChevronDown />}
        </Button>
      </div>

      {attempt ? (
        <div
          className={`agent-login-attempt agent-login-attempt-${attempt.status}`}
          role="status"
          aria-live="polite"
        >
          <div className="agent-login-attempt-header">
            <strong>{attemptLabel(attempt.status)}</strong>
            {attemptActive ? (
              <Button variant="ghost" size="sm" disabled={busyAction !== null} onClick={onCancelLogin}>
                Cancel
              </Button>
            ) : null}
          </div>
          {attempt.flow ? <LoginFlowView flow={attempt.flow} onCopy={onCopy} /> : null}
          {attempt.message ? <p>{attempt.message}</p> : null}
        </div>
      ) : null}

      {!snapshot?.installed && snapshot ? (
        <div className="agent-install-help">
          <strong>Install {meta.displayName}</strong>
          {snapshot.setup.installInstructions.map((instruction) => (
            <div key={`${instruction.platform}-${instruction.label}`}>
              <span>{instruction.label}</span>
              {instruction.command ? (
                <div className="agent-command-row">
                  <code>{instruction.command}</code>
                  <Button variant="outline" size="sm" onClick={() => onCopy(instruction.command ?? '')}>
                    <Copy />
                    Copy
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
          {snapshot.setup.docsUrl ? (
            <a href={snapshot.setup.docsUrl} target="_blank" rel="noreferrer">
              Open official setup guide
              <ExternalLink />
            </a>
          ) : null}
        </div>
      ) : null}

      {setupOpen && snapshot ? (
        <div id={setupPanelId} className="agent-local-setup">
          <div className="agent-local-setup-heading">
            <div>
              <strong>Local setup</strong>
              <span>Override auto-detection only when this machine needs a custom path.</span>
            </div>
            {snapshot.setup.docsUrl ? (
              <a href={snapshot.setup.docsUrl} target="_blank" rel="noreferrer">
                Docs
                <ExternalLink />
              </a>
            ) : null}
          </div>
          <label>
            <span>Binary path override</span>
            <Input
              value={draft.binaryPath}
              placeholder={snapshot.resolvedExecutablePath ?? '/absolute/path/to/cli'}
              onChange={(event) => onDraftChange('binaryPath', event.target.value)}
            />
          </label>
          {snapshot.homeSource !== null ? (
            <label>
              <span>Config home override</span>
              <Input
                value={draft.configHome}
                placeholder={snapshot.configHome ?? '/absolute/path/to/config'}
                onChange={(event) => onDraftChange('configHome', event.target.value)}
              />
            </label>
          ) : null}
          {snapshot.setup.loginCommand ? (
            <div className="agent-manual-command">
              <span>Manual login command</span>
              <div className="agent-command-row">
                <code>{snapshot.setup.loginCommand}</code>
                <Button variant="outline" size="sm" onClick={() => onCopy(snapshot.setup.loginCommand ?? '')}>
                  <Copy />
                  Copy
                </Button>
              </div>
            </div>
          ) : null}
          <div className="agent-local-setup-actions">
            <Button variant="outline" size="sm" disabled={busyAction !== null} onClick={onTestSetup}>
              Test
            </Button>
            <Button size="sm" disabled={busyAction !== null} onClick={onSaveSetup}>
              Save
            </Button>
            <Button variant="ghost" size="sm" disabled={busyAction !== null} onClick={onResetSetup}>
              Reset to auto-detect
            </Button>
          </div>
        </div>
      ) : null}

      {notice ? (
        <p className="agent-provider-notice" role="status" aria-live="polite">
          <Check />
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="agent-provider-error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  )
}

export function AgentSettingsPage({ onClose }: { onClose(): void }) {
  const [controlToken, setControlToken] = useState<string | null>(null)
  const [instances, setInstances] = useState<AgentProviderSnapshot[]>([])
  const [attempts, setAttempts] = useState<Record<string, AgentProviderLoginAttempt>>({})
  const [drafts, setDrafts] = useState<Record<string, SetupDraft>>({})
  const [openSetup, setOpenSetup] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<Record<string, string | null>>({})
  const [notices, setNotices] = useState<Record<string, string | null>>({})
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const [pageError, setPageError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshingAll, setRefreshingAll] = useState(false)

  const applyInstances = useCallback((next: AgentProviderSnapshot[]) => {
    setInstances(next)
    setDrafts((current) => {
      const updated = { ...current }
      for (const snapshot of next) {
        updated[snapshot.instanceId] ??= initialSetupDraft(snapshot)
      }
      return updated
    })
  }, [])

  const loadInstances = useCallback(
    async (token: string, silent = false) => {
      if (!silent) setLoading(true)
      try {
        const response = await api.listAgentProviderInstances(token)
        applyInstances(response.instances)
        setPageError(null)
      } catch (error) {
        if (!silent) setPageError(toErrorMessage(error))
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [applyInstances]
  )

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const scheduleRefresh = (token: string) => {
      timer = setTimeout(async () => {
        await loadInstances(token, true)
        if (active) scheduleRefresh(token)
      }, 5_000)
    }
    void api
      .getAgentProviderControlToken()
      .then(async ({ token }) => {
        if (!active) return
        setControlToken(token)
        await loadInstances(token)
        if (!active) return
        scheduleRefresh(token)
      })
      .catch((error) => {
        if (!active) return
        setPageError(toErrorMessage(error))
        setLoading(false)
      })
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [loadInstances])

  const activeAttemptIds = useMemo(
    () =>
      Object.values(attempts)
        .filter((attempt) => !TERMINAL_ATTEMPT_STATUSES.has(attempt.status))
        .map((attempt) => `${attempt.instanceId}\t${attempt.id}\t${attempt.expiresAt}`)
        .sort()
        .join('\n'),
    [attempts]
  )

  useEffect(() => {
    if (!controlToken || !activeAttemptIds) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const failureCounts = new Map<string, number>()
    const pending = activeAttemptIds.split('\n').map((value) => {
      const [instanceId, id, expiresAt] = value.split('\t')
      return { instanceId: instanceId!, id: id!, expiresAt: expiresAt! }
    })
    const poll = async () => {
      const expired = pending.filter((attempt) => isLoginAttemptExpired(attempt))
      const current = pending.filter((attempt) => !isLoginAttemptExpired(attempt))
      if (expired.length > 0) {
        setAttempts((attemptsByInstance) => {
          const updated = { ...attemptsByInstance }
          for (const attempt of expired) delete updated[attempt.instanceId]
          return updated
        })
        setErrors((currentErrors) => {
          const updated = { ...currentErrors }
          for (const attempt of expired) updated[attempt.instanceId] = 'Login attempt expired. Start again.'
          return updated
        })
        return
      }
      if (current.length === 0) return

      const results = await Promise.allSettled(
        current.map((attempt) =>
          api.getAgentProviderLoginAttempt(
            controlToken,
            attempt.instanceId,
            attempt.id,
            AbortSignal.timeout(LOGIN_POLL_REQUEST_TIMEOUT_MS)
          )
        )
      )
      if (!active) return
      const terminalSeen = results.some(
        (result) =>
          result.status === 'fulfilled' &&
          TERMINAL_ATTEMPT_STATUSES.has(result.value.attempt.status)
      )
      const updates: AgentProviderLoginAttempt[] = []
      const cleared: Array<{ instanceId: string; message: string }> = []
      let keepPolling = false
      results.forEach((result, index) => {
        const attempted = current[index]!
        if (result.status === 'fulfilled') {
          failureCounts.delete(attempted.instanceId)
          updates.push(result.value.attempt)
          keepPolling ||= !TERMINAL_ATTEMPT_STATUSES.has(result.value.attempt.status)
          return
        }

        const failures = (failureCounts.get(attempted.instanceId) ?? 0) + 1
        failureCounts.set(attempted.instanceId, failures)
        const missing = result.reason instanceof ApiRequestError && result.reason.status === 404
        if (missing || failures >= MAX_LOGIN_POLL_FAILURES) {
          cleared.push({
            instanceId: attempted.instanceId,
            message: missing
              ? 'Login attempt ended on the local server. Start again.'
              : 'Lost contact with the login attempt. Start again.'
          })
        } else {
          keepPolling = true
        }
      })
      setAttempts((attemptsByInstance) => {
        const updated = { ...attemptsByInstance }
        for (const attempt of updates) updated[attempt.instanceId] = attempt
        for (const item of cleared) delete updated[item.instanceId]
        return updated
      })
      if (cleared.length > 0) {
        setErrors((currentErrors) => {
          const updated = { ...currentErrors }
          for (const item of cleared) updated[item.instanceId] = item.message
          return updated
        })
      }
      if (terminalSeen) void loadInstances(controlToken, true)
      if (active && keepPolling) {
        timer = setTimeout(() => void poll(), LOGIN_POLL_INTERVAL_MS)
      }
    }
    void poll()
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [activeAttemptIds, controlToken, loadInstances])

  const updateInstance = useCallback((instance: AgentProviderSnapshot) => {
    setInstances((current) => {
      const index = current.findIndex((item) => item.instanceId === instance.instanceId)
      if (index === -1) return [...current, instance]
      const updated = [...current]
      updated[index] = instance
      return updated
    })
  }, [])

  const begin = (instanceId: string, action: string) => {
    setBusy((current) => ({ ...current, [instanceId]: action }))
    setNotices((current) => ({ ...current, [instanceId]: null }))
    setErrors((current) => ({ ...current, [instanceId]: null }))
  }

  const finish = (instanceId: string) => {
    setBusy((current) => ({ ...current, [instanceId]: null }))
  }

  const runSnapshotOperation = async (
    instanceId: string,
    action: string,
    successMessage: string,
    operation: (token: string) => Promise<AgentProviderSnapshotResponse>
  ) => {
    if (!controlToken) return
    begin(instanceId, action)
    try {
      const { instance } = await operation(controlToken)
      updateInstance(instance)
      setNotices((current) => ({ ...current, [instanceId]: successMessage }))
      return true
    } catch (error) {
      setErrors((current) => ({ ...current, [instanceId]: toErrorMessage(error) }))
      return false
    } finally {
      finish(instanceId)
    }
  }

  const refreshAll = async () => {
    if (!controlToken) return
    setRefreshingAll(true)
    setPageError(null)
    try {
      const responses = await Promise.all(
        PROVIDERS.map(({ instanceId }) => api.refreshAgentProvider(controlToken, instanceId))
      )
      applyInstances(responses.map(({ instance }) => instance))
    } catch (error) {
      setPageError(toErrorMessage(error))
    } finally {
      setRefreshingAll(false)
    }
  }

  const startLogin = async (instanceId: string) => {
    if (!controlToken) return
    begin(instanceId, 'login')
    try {
      const { attempt } = await api.createAgentProviderLoginAttempt(controlToken, instanceId)
      setAttempts((current) => ({ ...current, [instanceId]: attempt }))
    } catch (error) {
      setErrors((current) => ({ ...current, [instanceId]: toErrorMessage(error) }))
    } finally {
      finish(instanceId)
    }
  }

  const cancelLogin = async (instanceId: string) => {
    const attempt = attempts[instanceId]
    if (!controlToken || !attempt) return
    begin(instanceId, 'cancel-login')
    try {
      const response = await api.cancelAgentProviderLoginAttempt(controlToken, instanceId, attempt.id)
      setAttempts((current) => ({ ...current, [instanceId]: response.attempt }))
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) {
        setAttempts((current) => {
          const updated = { ...current }
          delete updated[instanceId]
          return updated
        })
      }
      setErrors((current) => ({ ...current, [instanceId]: toErrorMessage(error) }))
    } finally {
      finish(instanceId)
    }
  }

  const testSetup = async (instanceId: string) => {
    if (!controlToken) return
    begin(instanceId, 'test-setup')
    try {
      const response = await api.testAgentProviderSetup(
        controlToken,
        instanceId,
        setupInput(drafts[instanceId] ?? { binaryPath: '', configHome: '' })
      )
      const outcome = setupTestOutcome(response.instance)
      if (outcome.kind === 'success') {
        setNotices((current) => ({ ...current, [instanceId]: outcome.message }))
      } else {
        setErrors((current) => ({ ...current, [instanceId]: outcome.message }))
      }
    } catch (error) {
      setErrors((current) => ({ ...current, [instanceId]: toErrorMessage(error) }))
    } finally {
      finish(instanceId)
    }
  }

  const saveSetup = (instanceId: string) =>
    runSnapshotOperation(instanceId, 'save-setup', 'Local setup saved.', (token) =>
      api.saveAgentProviderSetup(
        token,
        instanceId,
        setupInput(drafts[instanceId] ?? { binaryPath: '', configHome: '' })
      )
    )

  const resetSetup = async (instanceId: string) => {
    const reset = await runSnapshotOperation(instanceId, 'reset-setup', 'Auto-detection restored.', (token) =>
      api.resetAgentProviderSetup(token, instanceId)
    )
    if (reset) {
      setDrafts((current) => ({
        ...current,
        [instanceId]: { binaryPath: '', configHome: '' }
      }))
    }
  }

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      setPageError('Could not copy to the clipboard.')
    }
  }

  return (
    <main className="agent-settings-page" data-testid="agent-settings-page">
      <header className="agent-settings-header">
        <div>
          <Button variant="ghost" size="sm" className="agent-settings-back" onClick={onClose}>
            <ArrowLeft />
            Back to workspace
          </Button>
          <h1>Agent settings</h1>
          <p>Detect, authorize, and configure coding agents installed on this machine.</p>
        </div>
        <Button
          variant="outline"
          disabled={!controlToken || loading || refreshingAll}
          onClick={() => void refreshAll()}
        >
          <RefreshCw className={refreshingAll ? 'is-spinning' : undefined} />
          Refresh all
        </Button>
      </header>

      {pageError ? (
        <div className="agent-settings-error-banner" role="alert">
          {pageError}
        </div>
      ) : null}

      <section className="agent-provider-grid" aria-label="Agent Providers">
        {PROVIDERS.map((meta) => {
          const snapshot = instances.find((instance) => instance.instanceId === meta.instanceId) ?? null
          return (
            <ProviderCard
              key={meta.instanceId}
              meta={meta}
              snapshot={snapshot}
              attempt={attempts[meta.instanceId] ?? null}
              setupOpen={openSetup[meta.instanceId] ?? false}
              draft={drafts[meta.instanceId] ?? { binaryPath: '', configHome: '' }}
              busyAction={busy[meta.instanceId] ?? null}
              notice={notices[meta.instanceId] ?? null}
              error={errors[meta.instanceId] ?? null}
              onRefresh={() =>
                void runSnapshotOperation(meta.instanceId, 'refresh', 'Status refreshed.', (token) =>
                  api.refreshAgentProvider(token, meta.instanceId)
                )
              }
              onLogin={() => void startLogin(meta.instanceId)}
              onCancelLogin={() => void cancelLogin(meta.instanceId)}
              onToggleSetup={() =>
                setOpenSetup((current) => ({
                  ...current,
                  [meta.instanceId]: !current[meta.instanceId]
                }))
              }
              onDraftChange={(field, value) =>
                setDrafts((current) => ({
                  ...current,
                  [meta.instanceId]: {
                    ...(current[meta.instanceId] ?? { binaryPath: '', configHome: '' }),
                    [field]: value
                  }
                }))
              }
              onTestSetup={() => void testSetup(meta.instanceId)}
              onSaveSetup={() => void saveSetup(meta.instanceId)}
              onResetSetup={() => void resetSetup(meta.instanceId)}
              onCopy={(value) => void copy(value)}
            />
          )
        })}
      </section>
    </main>
  )
}
