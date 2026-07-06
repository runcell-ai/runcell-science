import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentProvider } from '@runcell-science/contracts'
import { Check, ChevronsUpDown, Cpu } from 'lucide-react'

import { providerLabel } from './utils'
import type { AgentModelChoice, AgentModelOption } from './types'

type AgentModelSelectorProps = {
  /** Flat list of selectable models; grouped by provider in display order. */
  options: AgentModelOption[]
  selectedProvider: AgentProvider
  /** null means "use the provider's default model". */
  selectedModel: string | null
  /** When true the current choice is shown read-only (e.g. an active session). */
  disabled?: boolean
  onChange: (choice: AgentModelChoice) => void
}

function isSameChoice(option: AgentModelOption, provider: AgentProvider, model: string | null): boolean {
  return option.provider === provider && (option.model ?? null) === (model ?? null)
}

/**
 * Agent + model picker for the composer footer. A single control chooses both
 * the provider (Codex / Claude Code) and the model within it, grouped the way
 * the reference model menu is: provider headers with their models beneath.
 */
function AgentModelSelector({
  options,
  selectedProvider,
  selectedModel,
  disabled = false,
  onChange
}: AgentModelSelectorProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const groups = useMemo(() => {
    const order: AgentProvider[] = []
    const byProvider = new Map<AgentProvider, AgentModelOption[]>()
    for (const option of options) {
      const bucket = byProvider.get(option.provider)
      if (bucket) {
        bucket.push(option)
      } else {
        byProvider.set(option.provider, [option])
        order.push(option.provider)
      }
    }
    return order.map((provider) => ({ provider, items: byProvider.get(provider) ?? [] }))
  }, [options])

  const selected = useMemo(
    () => options.find((option) => isSameChoice(option, selectedProvider, selectedModel)),
    [options, selectedProvider, selectedModel]
  )

  const agentLabel = providerLabel(selectedProvider)
  const modelLabel = selected?.label ?? selectedModel ?? 'Default'

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

  useEffect(() => {
    if (disabled) {
      setOpen(false)
    }
  }, [disabled])

  function pick(option: AgentModelOption) {
    onChange({ provider: option.provider, model: option.model ?? null })
    setOpen(false)
  }

  return (
    <div className="model-selector" ref={containerRef}>
      <button
        type="button"
        className="model-selector-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <Cpu className="model-selector-icon" />
        <span className="model-selector-agent">{agentLabel}</span>
        <span className="model-selector-model">{modelLabel}</span>
        {disabled ? null : <ChevronsUpDown className="model-selector-caret" />}
      </button>
      {open && !disabled ? (
        <div className="model-selector-menu" role="listbox" aria-label="Agent and model">
          {groups.map((group) => (
            <div key={group.provider} className="model-selector-group">
              <div className="model-selector-group-label">{providerLabel(group.provider)}</div>
              {group.items.map((option) => {
                const active = isSameChoice(option, selectedProvider, selectedModel)
                return (
                  <button
                    key={`${option.provider}:${option.model ?? 'default'}`}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`model-selector-option${active ? ' is-selected' : ''}`}
                    onClick={() => pick(option)}
                  >
                    <span className="model-selector-option-label">{option.label}</span>
                    {option.hint ? <span className="model-selector-option-hint">{option.hint}</span> : null}
                    <Check className={`model-selector-check${active ? '' : ' is-hidden'}`} />
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export { AgentModelSelector }
export type { AgentModelSelectorProps }
