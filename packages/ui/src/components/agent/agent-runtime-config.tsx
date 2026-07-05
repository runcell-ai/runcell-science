import { Input } from '../ui/input'

type AgentRuntimeConfigProps = {
  isDraft: boolean
  cwd: string
  activeCwd: string | undefined
  onCwdChange: (cwd: string) => void
}

/**
 * Draft-only working-directory setup. Agent + model are chosen from the
 * composer's model picker, so this no longer duplicates a provider control.
 */
function AgentRuntimeConfig({ isDraft, cwd, activeCwd, onCwdChange }: AgentRuntimeConfigProps) {
  return (
    <div className="runtime-config">
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
