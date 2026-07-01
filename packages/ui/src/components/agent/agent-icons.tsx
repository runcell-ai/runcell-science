import type { AgentMessage } from '@open-science/contracts'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Loader2,
  Terminal,
  UserRound
} from 'lucide-react'

function AgentActivityIcon({ status }: { status?: string | null }) {
  if (status === 'completed' || status === 'resolved') {
    return <CheckCircle2 className="activity-icon activity-icon-success" />
  }
  if (status === 'failed' || status === 'error') {
    return <AlertTriangle className="activity-icon activity-icon-error" />
  }
  if (status === 'running' || status === 'started' || status === 'open') {
    return <Loader2 className="activity-icon activity-icon-running" />
  }
  return <Terminal className="activity-icon" />
}

function AgentMessageIcon({ role }: { role: AgentMessage['role'] }) {
  if (role === 'assistant') {
    return <Bot className="message-icon" />
  }
  return <UserRound className="message-icon" />
}

export { AgentActivityIcon, AgentMessageIcon }
