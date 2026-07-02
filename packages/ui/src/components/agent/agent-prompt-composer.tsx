import type { FormEvent, KeyboardEvent } from 'react'
import { Loader2, Send } from 'lucide-react'

import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'

type AgentPromptComposerProps = {
  value: string
  canSend: boolean
  isSending: boolean
  disabled: boolean
  placeholder?: string
  onValueChange: (value: string) => void
  onSubmit: () => void
}

function AgentPromptComposer({
  value,
  canSend,
  isSending,
  disabled,
  placeholder = 'Describe the task for the agent',
  onValueChange,
  onSubmit
}: AgentPromptComposerProps) {
  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (canSend) {
      onSubmit()
    }
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      if (canSend) {
        onSubmit()
      }
    }
  }

  return (
    <form className="composer" onSubmit={submitMessage}>
      <Textarea
        className="composer-input"
        rows={3}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={handleDraftKeyDown}
        disabled={disabled}
      />
      <div className="composer-footer">
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
    </form>
  )
}

export { AgentPromptComposer }
