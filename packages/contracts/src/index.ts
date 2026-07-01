export type HealthStatus = 'ok' | 'degraded'

export interface HealthCheckResponse {
  status: HealthStatus
  service: string
  version: string
  checkedAt: string
  environment: string
}

export interface ApiInfo {
  service: 'web' | 'server'
  version: string
  environment: string
}
