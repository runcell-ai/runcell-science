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
  placeholder = 'Message',
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
        rows={3}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={handleDraftKeyDown}
        disabled={disabled}
      />
      <Button
        className="primary-action send-button"
        type="submit"
        disabled={!canSend}
      >
        {isSending ? <Loader2 className="spin-icon" /> : <Send />}
        Send
      </Button>
    </form>
  )
}

export { AgentPromptComposer }
