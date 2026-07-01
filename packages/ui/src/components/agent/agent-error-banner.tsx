import { AlertTriangle } from 'lucide-react'

function AgentErrorBanner({ message }: { message: string | null }) {
  if (!message) {
    return null
  }

  return (
    <div className="error-banner">
      <AlertTriangle />
      <span>{message}</span>
    </div>
  )
}

export { AgentErrorBanner }
