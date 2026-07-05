import { useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, ReactNode } from 'react'
import { Loader2, Send } from 'lucide-react'

import { Button } from '../ui/button'
import { EditableInput } from '../ui/editable-input'
import type { EditableInputHandle } from '../ui/editable-input'

type ComposerSkill = {
  name: string
  description?: string | null
}

type AgentPromptComposerProps = {
  value: string
  canSend: boolean
  isSending: boolean
  disabled: boolean
  placeholder?: string
  skills?: ComposerSkill[]
  skillTrigger?: string
  /** Rendered at the start (left) of the footer, e.g. the agent+model picker. */
  footerSlot?: ReactNode
  onValueChange: (value: string) => void
  onSubmit: () => void
}

type SkillMenuState = {
  query: string
  triggerStart: number
  caret: number
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function AgentPromptComposer({
  value,
  canSend,
  isSending,
  disabled,
  placeholder = 'Describe the task for the agent',
  skills,
  skillTrigger,
  footerSlot,
  onValueChange,
  onSubmit
}: AgentPromptComposerProps) {
  const editableRef = useRef<EditableInputHandle | null>(null)
  const [menu, setMenu] = useState<SkillMenuState | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)

  const matches = useMemo(() => {
    if (!menu || !skills || skills.length === 0) {
      return []
    }
    const query = menu.query.toLowerCase()
    const seen = new Set<string>()
    const result: ComposerSkill[] = []
    for (const skill of skills) {
      if (!skill.name.toLowerCase().includes(query) || seen.has(skill.name)) {
        continue
      }
      seen.add(skill.name)
      result.push(skill)
      if (result.length >= 8) {
        break
      }
    }
    return result
  }, [menu, skills])

  const menuVisible = menu !== null && matches.length > 0

  function updateMenuFromCaret(nextValue: string, caret: number) {
    if (!skillTrigger || !skills || skills.length === 0) {
      return
    }
    const before = nextValue.slice(0, caret)
    const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(skillTrigger)}([A-Za-z0-9._:-]*)$`)
    const match = before.match(pattern)
    if (match) {
      setMenu({
        query: match[1] ?? '',
        triggerStart: caret - (match[1]?.length ?? 0) - skillTrigger.length,
        caret
      })
      setSelectedIndex(0)
    } else {
      setMenu(null)
    }
  }

  function handleChange(nextValue: string, caret: number) {
    onValueChange(nextValue)
    updateMenuFromCaret(nextValue, caret)
  }

  function pickSkill(skill: ComposerSkill) {
    if (!menu || !skillTrigger) {
      return
    }
    const insertion = `${skillTrigger}${skill.name} `
    const nextValue = value.slice(0, menu.triggerStart) + insertion + value.slice(menu.caret)
    onValueChange(nextValue)
    setMenu(null)
    const nextCaret = menu.triggerStart + insertion.length
    requestAnimationFrame(() => {
      editableRef.current?.focus()
      editableRef.current?.setCaret(nextCaret)
    })
  }

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (canSend) {
      onSubmit()
    }
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Never steal keys while an IME composition is being confirmed.
    if (event.nativeEvent.isComposing) {
      return
    }

    if (menuVisible) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSelectedIndex((index) => (index + 1) % matches.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSelectedIndex((index) => (index - 1 + matches.length) % matches.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        pickSkill(matches[Math.min(selectedIndex, matches.length - 1)])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setMenu(null)
        return
      }
    }

    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      if (canSend) {
        onSubmit()
      }
    }
  }

  return (
    <form className="composer" onSubmit={submitMessage}>
      {menuVisible ? (
        <div className="composer-skill-menu" role="listbox" aria-label="Skills">
          {matches.map((skill, index) => (
            <button
              key={`${skill.name}-${index}`}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              className={`composer-skill-item${index === selectedIndex ? ' composer-skill-item-active' : ''}`}
              onMouseDown={(event) => {
                event.preventDefault()
                pickSkill(skill)
              }}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className="composer-skill-name">
                {skillTrigger}
                {skill.name}
              </span>
              {skill.description ? <span className="composer-skill-description">{skill.description}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      <EditableInput
        ref={editableRef}
        className="composer-input"
        ariaLabel="Message"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={handleChange}
        onKeyDown={handleDraftKeyDown}
      />
      <div className="composer-footer">
        <div className="composer-footer-lead">{footerSlot}</div>
        <div className="composer-footer-actions">
          <span className="composer-hint">
            <kbd>⌘</kbd>
            <kbd>↵</kbd>
            to send
          </span>
          <Button type="submit" size="sm" disabled={!canSend}>
            {isSending ? <Loader2 className="spin-icon" /> : <Send />}
            Send
          </Button>
        </div>
      </div>
    </form>
  )
}

export { AgentPromptComposer }
export type { ComposerSkill }
