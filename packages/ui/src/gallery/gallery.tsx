import { useEffect, useState } from 'react'
import type { AgentSessionSummary } from '@open-science/contracts'
import {
  CheckIcon,
  MonitorIcon,
  MoonIcon,
  PanelRightOpenIcon,
  SearchIcon,
  SendIcon,
  SunIcon
} from 'lucide-react'

import {
  AgentConversationHeader,
  AgentErrorBanner,
  AgentModelSelector,
  AgentPromptComposer,
  AgentRuntimeConfig,
  AgentSessionSidebar,
  AgentTimeline,
  Button,
  Input,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ScrollArea,
  Separator,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '../index'
import type { AgentModelChoice, AgentModelOption, AgentProviderOption, AgentTimelineItem } from '../index'

type ThemeMode = 'light' | 'dark' | 'system'

type ComponentGroup = {
  id: string
  label: string
  items: string[]
}

const groups: ComponentGroup[] = [
  {
    id: 'agent-session',
    label: 'Agent Session',
    items: ['Session list', 'Header', 'Runtime config']
  },
  {
    id: 'prompt-input',
    label: 'Prompt Input',
    items: ['Composer', 'States']
  },
  {
    id: 'tool-calls',
    label: 'Tool Calls',
    items: ['Activity', 'Permission request']
  },
  {
    id: 'foundations',
    label: 'Foundations',
    items: ['Tokens', 'Typography', 'Theme']
  },
  {
    id: 'primitives',
    label: 'Primitives',
    items: ['Button', 'Input', 'Sheet', 'ScrollArea']
  }
]

const tokenSwatches = [
  { name: 'Primary', value: 'var(--primary)' },
  { name: 'Success', value: 'var(--success)' },
  { name: 'Warning', value: 'var(--warning)' },
  { name: 'Destructive', value: 'var(--destructive)' },
  { name: 'Secondary', value: 'var(--secondary)' },
  { name: 'Muted', value: 'var(--muted)' },
  { name: 'Surface', value: 'var(--surface)' },
  { name: 'Border', value: 'var(--border)' }
]

const themeOptions: Array<{
  value: ThemeMode
  label: string
  icon: typeof SunIcon
}> = [
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
  { value: 'system', label: 'System', icon: MonitorIcon }
]

const galleryProviderOptions: AgentProviderOption[] = [
  { value: 'codex', label: 'Codex' },
  { value: 'claude', label: 'Claude Code' }
]

const galleryModelOptions: AgentModelOption[] = [
  { provider: 'codex', model: null, label: 'Default', hint: 'CLI default' },
  { provider: 'codex', model: 'gpt-5-codex', label: 'GPT-5 Codex' },
  { provider: 'codex', model: 'gpt-5', label: 'GPT-5' },
  { provider: 'claude', model: null, label: 'Default', hint: 'CLI default' },
  { provider: 'claude', model: 'opus', label: 'Opus' },
  { provider: 'claude', model: 'sonnet', label: 'Sonnet' },
  { provider: 'claude', model: 'haiku', label: 'Haiku' }
]

const gallerySessions: AgentSessionSummary[] = [
  {
    id: 'session-1',
    provider: 'codex',
    title: 'Refactor UI package boundaries',
    cwd: '/Users/example/open-science',
    model: null,
    runtimeMode: 'full_access',
    status: 'running',
    activatedAt: '2026-07-01T12:00:00.000Z',
    updatedAt: '2026-07-01T12:08:00.000Z'
  },
  {
    id: 'session-2',
    provider: 'claude',
    title: 'Inspect runtime event stream',
    cwd: '/Users/example/open-science',
    model: null,
    runtimeMode: 'default',
    status: 'ready',
    activatedAt: '2026-07-01T11:42:00.000Z',
    updatedAt: '2026-07-01T11:52:00.000Z'
  }
]

const galleryTimelineItems: AgentTimelineItem[] = [
  {
    id: 'message-1',
    type: 'message',
    createdAt: '2026-07-01T12:00:00.000Z',
    message: {
      id: 'message-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      role: 'user',
      text: 'Extract the agent session UI and prompt composer into the UI package.',
      status: 'completed',
      providerItemId: null,
      createdAt: '2026-07-01T12:00:00.000Z',
      updatedAt: '2026-07-01T12:00:00.000Z'
    }
  },
  {
    id: 'event-1',
    type: 'activity',
    createdAt: '2026-07-01T12:01:00.000Z',
    event: {
      id: 'event-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      provider: 'codex',
      eventType: 'tool.call.started',
      streamKind: null,
      title: 'Read app.tsx',
      summary: 'Inspecting existing session, prompt, and tool-call rendering.',
      status: 'completed',
      createdAt: '2026-07-01T12:01:00.000Z'
    }
  },
  {
    id: 'request-1',
    type: 'request',
    createdAt: '2026-07-01T12:02:00.000Z',
    request: {
      id: 'request-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      type: 'apply_patch',
      status: 'open',
      title: 'Allow file edits in packages/ui?',
      payloadJson: '{}',
      responseJson: null,
      createdAt: '2026-07-01T12:02:00.000Z',
      resolvedAt: null
    }
  },
  {
    id: 'message-2',
    type: 'message',
    createdAt: '2026-07-01T12:03:00.000Z',
    message: {
      id: 'message-2',
      sessionId: 'session-1',
      turnId: 'turn-1',
      role: 'assistant',
      text: [
        'The session UI now lives in `packages/ui`. Key moves:',
        '',
        '- **Components**: `AgentTimeline`, `AgentPromptComposer`, and the sidebar',
        '- **Tokens**: colors, radii, and type families in `styles.css`',
        '',
        'Next I suggest extracting the artifact preview panel as well.'
      ].join('\n'),
      status: 'completed',
      providerItemId: null,
      createdAt: '2026-07-01T12:03:00.000Z',
      updatedAt: '2026-07-01T12:03:00.000Z'
    }
  }
]

function applyTheme(mode: ThemeMode) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.classList.toggle(
    'dark',
    mode === 'dark' || (mode === 'system' && prefersDark)
  )
}

function Gallery() {
  const [theme, setTheme] = useState<ThemeMode>('light')
  const [activeGroup, setActiveGroup] = useState(groups[0].id)
  const [activeSessionId, setActiveSessionId] = useState(gallerySessions[0].id)
  const [selectedProvider, setSelectedProvider] = useState(galleryProviderOptions[0].value)
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [cwd, setCwd] = useState('/Users/example/open-science')

  const handleModelChoice = (choice: AgentModelChoice) => {
    setSelectedProvider(choice.provider)
    setSelectedModel(choice.model)
  }
  const [promptDraft, setPromptDraft] = useState(
    'Summarize the current runtime events and suggest the next UI extraction.'
  )

  const activeItems =
    groups.find((group) => group.id === activeGroup)?.items ?? []

  useEffect(() => {
    applyTheme(theme)
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => applyTheme(theme)
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [theme])

  return (
    <TooltipProvider>
      <div className="gallery-shell">
        <aside className="gallery-sidebar">
          <div className="gallery-brand">
            <span className="gallery-mark">OS</span>
            <div>
              <h1>Open Science UI</h1>
              <p>Manuscript design language</p>
            </div>
          </div>

          <nav className="gallery-nav" aria-label="Component groups">
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                className={group.id === activeGroup ? 'is-active' : undefined}
                onClick={() => setActiveGroup(group.id)}
              >
                <span>{group.label}</span>
                <span>{group.items.length}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="gallery-main">
          <header className="gallery-toolbar">
            <div>
              <p className="gallery-eyebrow">Gallery</p>
              <h2>{groups.find((group) => group.id === activeGroup)?.label}</h2>
            </div>
            <div className="theme-segments" aria-label="Theme">
              {themeOptions.map((option) => {
                const Icon = option.icon
                return (
                  <Button
                    key={option.value}
                    type="button"
                    variant={theme === option.value ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setTheme(option.value)}
                  >
                    <Icon />
                    {option.label}
                  </Button>
                )
              })}
            </div>
          </header>

          <ScrollArea className="gallery-scroll">
            <section className="component-index" aria-label="Visible items">
              {activeItems.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </section>

            <Separator className="gallery-divider" />

            <section className="preview-grid">
              {activeGroup === 'agent-session' && (
                <>
                  <article className="preview-card">
                    <header>
                      <h3>Session List</h3>
                      <span>agent</span>
                    </header>
                    <div className="agent-demo-panel">
                      <AgentSessionSidebar
                        sessions={gallerySessions}
                        activeSessionId={activeSessionId}
                        onRefresh={() => undefined}
                        onStartDraft={() => setActiveSessionId('')}
                        onOpenSession={setActiveSessionId}
                      />
                    </div>
                  </article>

                  <article className="preview-card">
                    <header>
                      <h3>Session Header</h3>
                      <span>live state</span>
                    </header>
                    <div className="agent-demo-stack">
                      <AgentConversationHeader
                        title="Refactor UI package boundaries"
                        providerLabel="Codex"
                        status="running"
                        connectionStatus="live"
                        running
                        path="/Users/example/open-science"
                        artifactCount={2}
                        onOpenArtifacts={() => undefined}
                        onInterrupt={() => undefined}
                      />
                      <AgentErrorBanner message="Example runtime warning shown in the conversation shell." />
                    </div>
                  </article>

                  <article className="preview-card preview-card-wide">
                    <header>
                      <h3>Runtime Config</h3>
                      <span>draft setup</span>
                    </header>
                    <div className="agent-demo-runtime">
                      <AgentModelSelector
                        options={galleryModelOptions}
                        selectedProvider={selectedProvider}
                        selectedModel={selectedModel}
                        onChange={handleModelChoice}
                      />
                      <AgentRuntimeConfig isDraft cwd={cwd} activeCwd={cwd} onCwdChange={setCwd} />
                    </div>
                  </article>
                </>
              )}

              {activeGroup === 'prompt-input' && (
                <>
                  <article className="preview-card preview-card-wide">
                    <header>
                      <h3>Prompt Composer</h3>
                      <span>editable</span>
                    </header>
                    <AgentPromptComposer
                      value={promptDraft}
                      canSend={promptDraft.trim().length > 0}
                      isSending={false}
                      disabled={false}
                      footerSlot={
                        <AgentModelSelector
                          options={galleryModelOptions}
                          selectedProvider={selectedProvider}
                          selectedModel={selectedModel}
                          onChange={handleModelChoice}
                        />
                      }
                      onValueChange={setPromptDraft}
                      onSubmit={() => undefined}
                    />
                  </article>

                  <article className="preview-card preview-card-wide">
                    <header>
                      <h3>Sending State</h3>
                      <span>disabled</span>
                    </header>
                    <AgentPromptComposer
                      value="Running a turn disables the composer while preserving the draft."
                      canSend={false}
                      isSending
                      disabled
                      onValueChange={() => undefined}
                      onSubmit={() => undefined}
                    />
                  </article>
                </>
              )}

              {activeGroup === 'tool-calls' && (
                <article className="preview-card preview-card-wide">
                  <header>
                    <h3>Tool Calls Timeline</h3>
                    <span>activity + request</span>
                  </header>
                  <div className="agent-demo-chat">
                    <AgentTimeline
                      items={galleryTimelineItems}
                      running
                      resolvingRequestId={null}
                      onResolveRequest={() => undefined}
                      onOpenArtifact={() => undefined}
                    />
                  </div>
                </article>
              )}

              {activeGroup === 'foundations' && (
                <>
                  <article className="preview-card">
                    <header>
                      <h3>Tokens</h3>
                      <span>{tokenSwatches.length}</span>
                    </header>
                    <div className="token-grid">
                      {tokenSwatches.map((token) => (
                        <div key={token.name} className="token-row">
                          <span
                            className="token-swatch"
                            style={{ background: token.value }}
                          />
                          <span>{token.name}</span>
                          <code>{token.value}</code>
                        </div>
                      ))}
                    </div>
                  </article>

                  <article className="preview-card preview-card-wide">
                    <header>
                      <h3>Typography</h3>
                      <span>3 families</span>
                    </header>
                    <div className="type-specimen">
                      <div className="type-specimen-row">
                        <span className="type-specimen-label">Serif · display</span>
                        <p className="type-specimen-serif">
                          The interface of record for scientific work
                        </p>
                      </div>
                      <div className="type-specimen-row">
                        <span className="type-specimen-label">Sans · interface</span>
                        <p className="type-specimen-sans">
                          Quiet chrome, prominent content. Body copy, labels, and
                          controls are set in the system sans.
                        </p>
                      </div>
                      <div className="type-specimen-row">
                        <span className="type-specimen-label">Mono · data</span>
                        <p className="type-specimen-mono">
                          ~/experiments/rna-seq/results_2026-07-01.parquet
                        </p>
                      </div>
                    </div>
                  </article>

                  <article className="preview-card">
                    <header>
                      <h3>Theme</h3>
                      <span>{theme}</span>
                    </header>
                    <div className="theme-preview">
                      <div className="theme-preview-surface">
                        <span>Surface</span>
                        <strong>Foreground</strong>
                      </div>
                      <Button>
                        <CheckIcon />
                        Primary
                      </Button>
                    </div>
                  </article>
                </>
              )}

              {activeGroup === 'primitives' && (
                <>
                  <article className="preview-card">
                    <header>
                      <h3>Button</h3>
                      <span>variants</span>
                    </header>
                    <div className="button-matrix">
                      <Button>
                        <CheckIcon />
                        Default
                      </Button>
                      <Button variant="secondary">Secondary</Button>
                      <Button variant="outline">Outline</Button>
                      <Button variant="ghost">Ghost</Button>
                      <Button variant="destructive">Destructive</Button>
                      <Button variant="link">Link</Button>
                    </div>
                  </article>

                  <article className="preview-card">
                    <header>
                      <h3>Tooltip</h3>
                      <span>overlay</span>
                    </header>
                    <div className="center-stage">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="outline" size="icon">
                            <SearchIcon />
                            <span className="sr-only">Search catalog</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Search catalog</TooltipContent>
                      </Tooltip>
                    </div>
                  </article>

                  <article className="preview-card preview-card-wide">
                    <header>
                      <h3>Input / Textarea</h3>
                      <span>form controls</span>
                    </header>
                    <div className="form-stack">
                      <label>
                        <span>Search</span>
                        <div className="input-with-icon">
                          <SearchIcon />
                          <Input placeholder="Dataset, paper, workflow" />
                        </div>
                      </label>
                      <label>
                        <span>Notes</span>
                        <Textarea placeholder="Review notes" />
                      </label>
                      <Button className="self-start">
                        <SendIcon />
                        Send
                      </Button>
                    </div>
                  </article>

                  <article className="preview-card">
                    <header>
                      <h3>Sheet</h3>
                      <span>right</span>
                    </header>
                    <div className="center-stage">
                      <Sheet>
                        <SheetTrigger asChild>
                          <Button variant="outline">
                            <PanelRightOpenIcon />
                            Open
                          </Button>
                        </SheetTrigger>
                        <SheetContent>
                          <SheetHeader>
                            <SheetTitle>Component Notes</SheetTitle>
                            <SheetDescription>
                              Primitive behavior and token coverage.
                            </SheetDescription>
                          </SheetHeader>
                          <div className="sheet-body">
                            <div>Status</div>
                            <strong>Ready for extraction</strong>
                          </div>
                          <SheetFooter>
                            <Button>Done</Button>
                          </SheetFooter>
                        </SheetContent>
                      </Sheet>
                    </div>
                  </article>

                  <article className="preview-card">
                    <header>
                      <h3>ScrollArea</h3>
                      <span>viewport</span>
                    </header>
                    <ScrollArea className="scroll-demo">
                      {Array.from({ length: 12 }, (_, index) => (
                        <div key={index} className="scroll-demo-row">
                          <span>Item {index + 1}</span>
                          <code>row-{index + 1}</code>
                        </div>
                      ))}
                    </ScrollArea>
                  </article>

                  <article className="preview-card preview-card-wide">
                    <header>
                      <h3>Resizable</h3>
                      <span>layout</span>
                    </header>
                    <div className="resizable-demo">
                      <ResizablePanelGroup direction="horizontal">
                        <ResizablePanel defaultSize={34} minSize={24}>
                          <div className="demo-pane">List</div>
                        </ResizablePanel>
                        <ResizableHandle withHandle />
                        <ResizablePanel defaultSize={66} minSize={36}>
                          <div className="demo-pane is-strong">Detail</div>
                        </ResizablePanel>
                      </ResizablePanelGroup>
                    </div>
                  </article>
                </>
              )}
            </section>
          </ScrollArea>
        </main>
      </div>
    </TooltipProvider>
  )
}

export { Gallery }
