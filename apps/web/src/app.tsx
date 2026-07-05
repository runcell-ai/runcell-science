import { useEffect, useState } from 'react'
import type { AgentProvider } from '@open-science/contracts'
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
} from '@open-science/ui'
import type { AgentModelChoice } from '@open-science/ui'
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
import { persistCwd, persistModelChoice, readStoredCwd, readStoredModelChoice } from './lib/storage'
import { NotebookExecutionCard } from './notebook/execution-card'
import './app.css'

const storedModelChoice = readStoredModelChoice()

function App() {
  const isNarrow = useIsNarrow()
  const [provider, setProvider] = useState<AgentProvider>(storedModelChoice?.provider ?? 'codex')
  const [model, setModel] = useState<string | null>(storedModelChoice?.model ?? null)
  const [modelOptions, setModelOptions] = useState(fallbackModelOptions)
  const [cwd, setCwd] = useState(readStoredCwd)
  const [connectorsOpen, setConnectorsOpen] = useState(false)
  const [skillsOpen, setSkillsOpen] = useState(false)

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

  const updateCwd = (value: string) => {
    setCwd(value)
    persistCwd(value)
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
          <ResizablePanel defaultSize={22} minSize={16} maxSize={32} className="panel sessions-panel">
            <AgentSessionSidebar
              sessions={sessionList.sessions}
              activeSessionId={workspace.activeSessionId}
              onRefresh={() => void sessionList.refresh()}
              onStartDraft={workspace.startDraft}
              onOpenSession={(sessionId) => void workspace.openSession(sessionId)}
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
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel
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
              <ResizablePanel defaultSize={38} minSize={24} maxSize={56} className="panel side-panel-slot">
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
