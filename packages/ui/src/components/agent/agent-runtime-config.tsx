import type { AgentProvider } from '@open-science/contracts'

import { Input } from '../ui/input'
import type { AgentProviderOption } from './types'

type AgentRuntimeConfigProps = {
  providerOptions: AgentProviderOption[]
  selectedProvider: AgentProvider
  isDraft: boolean
  isSending: boolean
  cwd: string
  activeCwd: string | undefined
  onProviderChange: (provider: AgentProvider) => void
  onCwdChange: (cwd: string) => void
}

function AgentRuntimeConfig({
  providerOptions,
  selectedProvider,
  isDraft,
  isSending,
  cwd,
  activeCwd,
  onProviderChange,
  onCwdChange
}: AgentRuntimeConfigProps) {
  return (
    <div className="runtime-config">
      <div className="field-block">
        <span className="field-label">Provider</span>
        <div className="segmented-control">
          {providerOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`segment-button ${
                selectedProvider === option.value ? 'is-selected' : ''
              }`}
              onClick={() => onProviderChange(option.value)}
              disabled={!isDraft || isSending}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field-block cwd-field">
        <span className="field-label">Working directory</span>
        {isDraft ? (
          <Input
            value={cwd}
            onChange={(event) => onCwdChange(event.target.value)}
            placeholder="/path/to/project"
          />
        ) : (
          <div className="readonly-path">{activeCwd}</div>
        )}
      </div>
    </div>
  )
}

export { AgentRuntimeConfig }
