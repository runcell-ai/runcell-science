import { useCallback, useEffect, useState } from 'react'
import type { AgentProvider, SkillView } from '@open-science/contracts'
import {
  Button,
  ScrollArea,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Input,
  Textarea
} from '@open-science/ui'
import { api, toErrorMessage } from './lib/api'

type SkillsPanelProps = {
  open: boolean
  cwd: string | null
  sessionId: string | null
  onOpenChange: (open: boolean) => void
}

export function SkillsPanel({ open, cwd, sessionId, onOpenChange }: SkillsPanelProps) {
  const [provider, setProvider] = useState<AgentProvider>('codex')
  const [skills, setSkills] = useState<SkillView[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyName, setBusyName] = useState<string | null>(null)

  const [importOpen, setImportOpen] = useState(false)
  const [importName, setImportName] = useState('')
  const [importContent, setImportContent] = useState('')
  const [importTargets, setImportTargets] = useState<AgentProvider[]>(['codex', 'claude'])
  const [importing, setImporting] = useState(false)

  const load = useCallback(
    async (refresh: boolean) => {
      setLoading(true)
      setError(null)
      try {
        const response = await api.listSkills({
          provider,
          cwd: cwd ?? undefined,
          sessionId: sessionId ?? undefined,
          refresh
        })
        setSkills(response.skills)
        setWarnings(response.warnings)
      } catch (err) {
        setError(toErrorMessage(err))
      } finally {
        setLoading(false)
      }
    },
    [provider, cwd, sessionId]
  )

  useEffect(() => {
    if (open) {
      setNotice(null)
      void load(false)
    }
  }, [open, load])

  const toggleSkill = async (skill: SkillView) => {
    setBusyName(skill.name)
    setError(null)
    try {
      await api.setSkillEnabled(skill.name, !skill.enabled)
      setNotice(`${skill.enabled ? 'Disabled' : 'Enabled'} ${skill.name}.`)
      await load(true)
    } catch (err) {
      setError(toErrorMessage(err))
    } finally {
      setBusyName(null)
    }
  }

  const toggleImportTarget = (target: AgentProvider) => {
    setImportTargets((current) =>
      current.includes(target) ? current.filter((p) => p !== target) : [...current, target]
    )
  }

  const submitImport = async () => {
    setImporting(true)
    setError(null)
    setNotice(null)
    try {
      const result = await api.importSkill({
        name: importName.trim(),
        content: importContent,
        providers: importTargets
      })
      const parts: string[] = []
      if (result.written.length > 0) parts.push(`written ${result.written.join(', ')}`)
      if (result.skipped.length > 0) parts.push(`skipped existing ${result.skipped.join(', ')}`)
      setNotice(`Import finished: ${parts.join(' · ') || 'nothing to do'}.`)
      if (result.written.length > 0) {
        setImportName('')
        setImportContent('')
        setImportOpen(false)
        await load(true)
      }
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
          <SheetTitle>Skills</SheetTitle>
          <SheetDescription>
            Skills live in the agents&apos; own directories. Mention them in the composer with {'`$name`'} (Codex) or{' '}
            {'`/name`'} (Claude Code).
          </SheetDescription>
        </SheetHeader>

        <div className="skills-provider-row">
          <Button
            size="sm"
            variant={provider === 'codex' ? 'default' : 'outline'}
            onClick={() => setProvider('codex')}
          >
            Codex
          </Button>
          <Button
            size="sm"
            variant={provider === 'claude' ? 'default' : 'outline'}
            onClick={() => setProvider('claude')}
          >
            Claude Code
          </Button>
          <span className="skills-provider-spacer" />
          <Button size="sm" variant="outline" onClick={() => setImportOpen((v) => !v)}>
            {importOpen ? 'Close import' : 'Import skill'}
          </Button>
          <Button size="sm" variant="outline" disabled={loading} onClick={() => void load(true)}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>

        {importOpen ? (
          <div className="connectors-import">
            <Input
              value={importName}
              placeholder="skill-name"
              onChange={(event) => setImportName(event.target.value)}
            />
            <Textarea
              value={importContent}
              placeholder={'---\nname: skill-name\ndescription: What this skill does.\n---\n\nInstructions…'}
              rows={7}
              onChange={(event) => setImportContent(event.target.value)}
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
                disabled={
                  importing ||
                  importName.trim().length === 0 ||
                  importContent.trim().length === 0 ||
                  importTargets.length === 0
                }
                onClick={() => void submitImport()}
              >
                {importing ? 'Importing…' : 'Import'}
              </Button>
            </div>
          </div>
        ) : null}

        {error ? <p className="connectors-error">{error}</p> : null}
        {notice ? <p className="connectors-notice">{notice}</p> : null}
        {warnings.map((warning) => (
          <p key={warning} className="connectors-warning">
            {warning}
          </p>
        ))}

        <ScrollArea className="connectors-list">
          {skills.length === 0 && !loading ? <p className="connectors-empty">No skills found.</p> : null}
          {skills.map((skill) => (
            <div key={`${skill.provider}:${skill.path ?? skill.name}`} className="connector-row">
              <div className="connector-row-main">
                <span className="connector-name">{skill.name}</span>
                <span className={`connector-status connector-status-${skill.enabled ? 'connected' : 'disabled'}`}>
                  {skill.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <div className="connector-row-meta">
                <span className="connector-chip">{skill.scope}</span>
              </div>
              {skill.description ? <p className="connector-detail skills-description">{skill.description}</p> : null}
              {skill.provider === 'codex' ? (
                <div className="connector-actions">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyName === skill.name}
                    onClick={() => void toggleSkill(skill)}
                  >
                    {busyName === skill.name ? 'Working…' : skill.enabled ? 'Disable' : 'Enable'}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
