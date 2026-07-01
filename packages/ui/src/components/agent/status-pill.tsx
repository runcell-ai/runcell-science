import { statusLabel } from './utils'

function StatusPill({ status }: { status: string }) {
  return <span className={`status-pill status-${status}`}>{statusLabel(status)}</span>
}

export { StatusPill }
