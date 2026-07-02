import { statusLabel } from './utils'

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`status-pill status-${status}`}>
      <span className="status-pill-dot" aria-hidden="true" />
      {statusLabel(status)}
    </span>
  )
}

export { StatusPill }
