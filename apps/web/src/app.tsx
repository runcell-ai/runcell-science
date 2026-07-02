import { useState } from 'react'
import type { AgentProvider } from '@open-science/contracts'
import {
  AgentConversationHeader,
  AgentErrorBanner,
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
import type { AgentProviderOption } from '@open-science/ui'
import { ArtifactsPanel } from './artifacts-panel'
import { ConnectorsPanel } from './connectors-panel'
import { WorktreeDiffPanel } from './worktree-diff-panel'
import { useIsNarrow } from './hooks/use-is-narrow'
import { useSessionList } from './hooks/use-session-list'
import { useSessionStream } from './hooks/use-session-stream'
import { useWorkspace } from './hooks/use-workspace'
import { apiBaseUrl } from './lib/api'
import { persistCwd, readStoredCwd } from './lib/storage'
import './app.css'

const providerOptions: AgentProviderOption[] = [
  { value: 'codex', label: 'Codex' },
  { value: 'claude', label: 'Claude Code' }
]

function App() {
  const isNarrow = useIsNarrow()
  const [provider, setProvider] = useState<AgentProvider>('codex')
  const [cwd, setCwd] = useState(readStoredCwd)
  const [connectorsOpen, setConnectorsOpen] = useState(false)

  const workspace = useWorkspace()
  const sessionList = useSessionList(workspace.reportError)
  const connectionStatus = useSessionStream(workspace.activeSessionId, {
    onEvent: workspace.handleRuntimeEvent,
    onSessionUpdated: sessionList.upsert,
    onTurnFinished: () => void sessionList.refresh({ silent: true })
  })

  const updateCwd = (value: string) => {
    setCwd(value)
    persistCwd(value)
  }

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
                  providerOptions={providerOptions}
                  selectedProvider={provider}
                  isDraft={workspace.isDraft}
                  isSending={workspace.isSending}
                  cwd={cwd}
                  activeCwd={workspace.detail?.session.cwd}
                  onProviderChange={setProvider}
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
            />

            <AgentPromptComposer
              value={workspace.messageDraft}
              canSend={canSend}
              isSending={workspace.isSending}
              disabled={workspace.isSending || workspace.running}
              onValueChange={workspace.setMessageDraft}
              onSubmit={() => void workspace.sendMessage({ provider, cwd })}
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

        <ConnectorsPanel
          open={connectorsOpen}
          cwd={workspace.detail?.session.cwd ?? (cwd.trim().length > 0 ? cwd : null)}
          onOpenChange={setConnectorsOpen}
        />
      </div>
    </TooltipProvider>
  )
}

export default App
