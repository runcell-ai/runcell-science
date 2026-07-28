import { useEffect, useMemo, useState } from 'react'
import type { AgentProvider } from '@runcell-science/contracts'
import {
  AgentConversationHeader,
  AgentErrorBanner,
  AgentModelSelector,
  AgentPromptComposer,
  AgentRuntimeConfig,
  AgentSessionSidebar,
  AgentTimeline,
  Button,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  TooltipProvider,
  displaySessionTitle,
  providerLabel
} from '@runcell-science/ui'
import type { AgentModelChoice } from '@runcell-science/ui'
import { Settings2 } from 'lucide-react'
import { AgentSettingsPage } from './agent-settings-page'
import { ArtifactsPanel } from './artifacts-panel'
import { ConnectorsPanel } from './connectors-panel'
import { SessionConnectorsMenu } from './session-connectors-menu'
import { SkillsPanel } from './skills-panel'
import { WorktreeDiffPanel } from './worktree-diff-panel'
import { useIsNarrow } from './hooks/use-is-narrow'
import { useSessionList } from './hooks/use-session-list'
import { useSessionStream } from './hooks/use-session-stream'
import { useSkills } from './hooks/use-skills'
import { useWorkspace } from './hooks/use-workspace'
import { api, apiBaseUrl } from './lib/api'
import { fallbackModelOptions, mergeModelOptions } from './lib/models'
import {
  persistCwd,
  persistModelChoice,
  pushRecentCwd,
  readRecentCwds,
  readStoredCwd,
  readStoredModelChoice
} from './lib/storage'
import { NotebookExecutionCard } from './notebook/execution-card'
import './app.css'

const storedModelChoice = readStoredModelChoice()

type AppView = 'workspace' | 'agent-settings'

function readAppView(): AppView {
  return window.location.hash === '#agent-settings' ? 'agent-settings' : 'workspace'
}

function App() {
  const isNarrow = useIsNarrow()
  const [provider, setProvider] = useState<AgentProvider>(storedModelChoice?.provider ?? 'codex')
  const [model, setModel] = useState<string | null>(storedModelChoice?.model ?? null)
  const [modelOptions, setModelOptions] = useState(fallbackModelOptions)
  const [cwd, setCwd] = useState(readStoredCwd)
  const [recentCwds, setRecentCwds] = useState(readRecentCwds)
  const [connectorsOpen, setConnectorsOpen] = useState(false)
  const [skillsOpen, setSkillsOpen] = useState(false)
  const [view, setView] = useState<AppView>(readAppView)

  const workspace = useWorkspace()
  const sessionList = useSessionList(workspace.reportError)
  const connectionStatus = useSessionStream(workspace.activeSessionId, {
    onEvent: workspace.handleRuntimeEvent,
    onSessionUpdated: sessionList.upsert,
    onTurnFinished: () => void sessionList.refresh({ silent: true })
  })

  useEffect(() => {
    let cancelled = false
    api
      .listModels()
      .then((response) => {
        if (!cancelled && response.models.length > 0) {
          setModelOptions(mergeModelOptions(response.models, fallbackModelOptions))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setModelOptions(fallbackModelOptions)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const handleHashChange = () => setView(readAppView())
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  const showWorkspace = () => {
    if (window.location.hash === '#agent-settings') {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    }
    setView('workspace')
  }

  const showAgentSettings = () => {
    window.location.hash = 'agent-settings'
    setView('agent-settings')
  }

  const updateCwd = (value: string) => {
    setCwd(value)
    persistCwd(value)
    setRecentCwds(pushRecentCwd(value))
  }

  const updateModelChoice = (choice: AgentModelChoice) => {
    setProvider(choice.provider)
    setModel(choice.model)
    persistModelChoice(choice)
  }

  const activeProvider = workspace.detail?.session.provider ?? provider
  // Agent + model are locked once a session exists; drafts stay editable.
  const selectedModel = workspace.detail ? workspace.detail.session.model : model
  const modelSelectorDisabled = !workspace.isDraft || workspace.isSending
  const activeCwd = workspace.detail?.session.cwd ?? (cwd.trim().length > 0 ? cwd : null)
  // Known working directories offered in the draft picker: whatever the user
  // has selected recently, plus the directories of existing sessions.
  const projects = useMemo(() => {
    const seen = new Set<string>()
    const list: string[] = []
    const add = (value: string | null | undefined) => {
      const trimmed = value?.trim()
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed)
        list.push(trimmed)
      }
    }
    add(cwd)
    recentCwds.forEach(add)
    sessionList.sessions.forEach((session) => add(session.cwd))
    return list
  }, [cwd, recentCwds, sessionList.sessions])
  const composerSkills = useSkills({
    provider: activeProvider,
    cwd: activeCwd,
    sessionId: workspace.activeSessionId
  })

  const artifactCount = workspace.detail?.artifacts.length ?? 0
  const canSend =
    workspace.messageDraft.trim().length > 0 &&
    !workspace.isSending &&
    !workspace.running &&
    (!workspace.isDraft || cwd.trim().length > 0)
  const activeTitle = workspace.detail ? displaySessionTitle(workspace.detail.session) : 'Draft conversation'

  return (
    <TooltipProvider>
      <div className="app-shell">
        <ResizablePanelGroup direction={isNarrow ? 'vertical' : 'horizontal'} className="shell-grid">
          <ResizablePanel
            id="sessions"
            order={1}
            defaultSize={22}
            minSize={16}
            maxSize={32}
            className="panel sessions-panel"
          >
            <AgentSessionSidebar
              sessions={sessionList.sessions}
              activeSessionId={workspace.activeSessionId}
              onRefresh={() => void sessionList.refresh()}
              onStartDraft={() => {
                showWorkspace()
                workspace.startDraft()
              }}
              onOpenSession={(sessionId) => {
                showWorkspace()
                void workspace.openSession(sessionId)
              }}
            />
            <div className="sidebar-footer">
              <Button
                variant="outline"
                size="sm"
                className="sidebar-footer-button"
                onClick={() => setConnectorsOpen(true)}
              >
                Connectors
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="sidebar-footer-button"
                onClick={() => setSkillsOpen(true)}
              >
                Skills
              </Button>
              <Button
                variant={view === 'agent-settings' ? 'secondary' : 'outline'}
                size="sm"
                className="sidebar-footer-button sidebar-footer-settings"
                aria-current={view === 'agent-settings' ? 'page' : undefined}
                onClick={showAgentSettings}
              >
                <Settings2 />
                Agent settings
              </Button>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {view === 'agent-settings' ? (
            <ResizablePanel
              id="agent-settings"
              order={2}
              defaultSize={78}
              minSize={40}
              className="panel agent-settings-panel"
            >
              <AgentSettingsPage onClose={showWorkspace} />
            </ResizablePanel>
          ) : (
            <>
          <ResizablePanel
            id="workspace"
            order={2}
            defaultSize={workspace.sidePanel && workspace.activeSessionId ? 44 : 78}
            minSize={40}
            className="panel chat-panel"
          >
            <div className="front-matter">
              <AgentConversationHeader
                title={activeTitle}
                providerLabel={
                  workspace.detail ? providerLabel(workspace.detail.session.provider) : providerLabel(provider)
                }
                status={workspace.detail ? workspace.detail.session.status : 'draft'}
                connectionStatus={workspace.activeSessionId ? connectionStatus : null}
                running={workspace.running}
                path={workspace.isDraft ? undefined : workspace.detail?.session.cwd}
                artifactCount={artifactCount}
                showDiffButton={workspace.diffAvailability === 'available' && workspace.sidePanel !== 'diff'}
                diffButtonDisabled={workspace.isLoadingWorktreeDiff}
                onOpenDiff={() => void workspace.openWorktreeDiff()}
                onOpenArtifacts={
                  workspace.activeSessionId && workspace.sidePanel !== 'artifacts'
                    ? workspace.openArtifactsPanel
                    : undefined
                }
                onInterrupt={() => void workspace.interruptSession()}
              />

              {workspace.isDraft ? (
                <AgentRuntimeConfig
                  isDraft={workspace.isDraft}
                  cwd={cwd}
                  activeCwd={workspace.detail?.session.cwd}
                  projects={projects}
                  onCwdChange={updateCwd}
                />
              ) : null}
            </div>

            <AgentErrorBanner message={workspace.errorMessage} />

            <AgentTimeline
              items={workspace.timelineItems}
              running={workspace.running}
              resolvingRequestId={workspace.resolvingRequestId}
              onResolveRequest={(request, decision) => void workspace.resolveRequest(request, decision)}
              onOpenArtifact={workspace.openArtifact}
              renderNotebookExecution={(item) => <NotebookExecutionCard item={item} />}
            />

            {workspace.activeSessionId && workspace.detail && !workspace.isDraft ? (
              <div className="composer-tools-row">
                <SessionConnectorsMenu
                  sessionId={workspace.activeSessionId}
                  provider={workspace.detail.session.provider}
                  cwd={workspace.detail.session.cwd}
                  disabledServers={workspace.detail.session.disabledMcpServers}
                  running={workspace.running}
                />
              </div>
            ) : null}

            <AgentPromptComposer
              value={workspace.messageDraft}
              canSend={canSend}
              isSending={workspace.isSending}
              disabled={workspace.isSending || workspace.running}
              skills={composerSkills.map((skill) => ({ name: skill.name, description: skill.description }))}
              skillTrigger={activeProvider === 'codex' ? '$' : '/'}
              footerSlot={
                <AgentModelSelector
                  options={modelOptions}
                  selectedProvider={activeProvider}
                  selectedModel={selectedModel}
                  disabled={modelSelectorDisabled}
                  onChange={updateModelChoice}
                />
              }
              onValueChange={workspace.setMessageDraft}
              onSubmit={() => void workspace.sendMessage({ provider, cwd, model })}
            />
          </ResizablePanel>

          {workspace.activeSessionId && workspace.sidePanel ? (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel
                id="side-panel"
                order={3}
                defaultSize={38}
                minSize={24}
                maxSize={56}
                className="panel side-panel-slot"
              >
                {workspace.sidePanel === 'artifacts' ? (
                  <ArtifactsPanel
                    apiBaseUrl={apiBaseUrl}
                    sessionId={workspace.activeSessionId}
                    artifacts={workspace.detail?.artifacts ?? []}
                    activeArtifactId={workspace.activeArtifactId}
                    draft={workspace.artifactDraft}
                    creating={workspace.isCreatingArtifact}
                    running={workspace.running}
                    focusFile={workspace.notebookFocus}
                    onDraftChange={workspace.setArtifactDraft}
                    onCreate={(value) => void workspace.createArtifact(value)}
                    onSelectArtifact={workspace.selectArtifact}
                    onClose={workspace.closeArtifactsPanel}
                  />
                ) : (
                  <WorktreeDiffPanel
                    diff={workspace.worktreeDiff}
                    loading={workspace.isLoadingWorktreeDiff}
                    path={workspace.detail?.session.cwd ?? cwd}
                    onRefresh={() => void workspace.openWorktreeDiff()}
                    onClose={workspace.closeWorktreeDiff}
                  />
                )}
              </ResizablePanel>
            </>
          ) : null}
            </>
          )}
        </ResizablePanelGroup>

        <ConnectorsPanel open={connectorsOpen} cwd={activeCwd} onOpenChange={setConnectorsOpen} />
        <SkillsPanel
          open={skillsOpen}
          cwd={activeCwd}
          sessionId={workspace.activeSessionId}
          onOpenChange={setSkillsOpen}
        />
      </div>
    </TooltipProvider>
  )
}

export default App
