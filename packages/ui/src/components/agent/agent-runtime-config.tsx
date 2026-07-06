import { useEffect, useRef, useState } from 'react'
import { Check, ChevronsUpDown, CornerDownLeft, Folder, FolderOpen } from 'lucide-react'

import { projectNameFromPath } from './utils'

type AgentRuntimeConfigProps = {
  isDraft: boolean
  cwd: string
  activeCwd: string | undefined
  /** Known working directories to switch between, most recent first. */
  projects: string[]
  onCwdChange: (cwd: string) => void
}

/**
 * Draft-only working-directory picker. Instead of a raw path field, it shows
 * the current project by its folder name and opens a menu to switch between
 * known projects or point at another directory. Agent + model are chosen from
 * the composer's model picker, so this no longer duplicates a provider control.
 */
function AgentRuntimeConfig({ isDraft, cwd, activeCwd, projects, onCwdChange }: AgentRuntimeConfigProps) {
  const [open, setOpen] = useState(false)
  const [customPath, setCustomPath] = useState('')
  const containerRef = useRef<HTMLDivElement | null>(null)

  const selectedPath = (isDraft ? cwd : activeCwd ?? '').trim()
  const projectName = projectNameFromPath(selectedPath)

  useEffect(() => {
    if (!open) {
      return
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  function choose(path: string): void {
    const trimmed = path.trim()
    if (!trimmed) {
      return
    }
    onCwdChange(trimmed)
    setCustomPath('')
    setOpen(false)
  }

  // An active session's directory is fixed, so render it as a static chip.
  if (!isDraft) {
    return (
      <div className="runtime-config">
        <div className="field-block">
          <span className="field-label">Working directory</span>
          <div className="project-display" title={selectedPath || undefined}>
            <FolderOpen className="project-display-icon" />
            <span className="project-display-name">{projectName || 'Unknown'}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="runtime-config">
      <div className="field-block">
        <span className="field-label">Working directory</span>
        <div className="project-selector" ref={containerRef}>
          <button
            type="button"
            className="project-selector-trigger"
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            title={selectedPath || undefined}
          >
            <FolderOpen className="project-selector-icon" />
            <span className={`project-selector-name${projectName ? '' : ' is-placeholder'}`}>
              {projectName || 'Select a project'}
            </span>
            <ChevronsUpDown className="project-selector-caret" />
          </button>

          {open ? (
            <div className="project-selector-menu" role="listbox" aria-label="Working directory">
              <div className="project-selector-section">
                <div className="project-selector-section-label">Projects</div>
                {projects.length > 0 ? (
                  projects.map((path) => {
                    const active = path === selectedPath
                    return (
                      <button
                        key={path}
                        type="button"
                        role="option"
                        aria-selected={active}
                        className={`project-selector-option${active ? ' is-selected' : ''}`}
                        onClick={() => choose(path)}
                      >
                        <Folder className="project-selector-option-icon" />
                        <span className="project-selector-option-labels">
                          <span className="project-selector-option-name">{projectNameFromPath(path)}</span>
                          <span className="project-selector-option-path">{path}</span>
                        </span>
                        <Check className={`project-selector-check${active ? '' : ' is-hidden'}`} />
                      </button>
                    )
                  })
                ) : (
                  <p className="project-selector-empty">No projects yet — choose a directory below.</p>
                )}
              </div>

              <div className="project-selector-section project-selector-custom">
                <div className="project-selector-section-label">Choose a directory</div>
                <div className="project-selector-custom-row">
                  <input
                    className="project-selector-input"
                    value={customPath}
                    onChange={(event) => setCustomPath(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        choose(customPath)
                      }
                    }}
                    placeholder="/path/to/project"
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className="project-selector-use"
                    onClick={() => choose(customPath)}
                    disabled={customPath.trim().length === 0}
                    aria-label="Use this directory"
                  >
                    <CornerDownLeft />
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export { AgentRuntimeConfig }
