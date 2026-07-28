import crypto from 'node:crypto'

import type { FastifyRequest } from 'fastify'

import { config } from '../config/env'

const RATE_WINDOW_MS = 60_000
const RATE_LIMIT = 30
const INVALID_TOKEN_RATE_LIMIT = 10

export class AgentProviderControlError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number
  ) {
    super(message)
    this.name = 'AgentProviderControlError'
  }
}

export interface AgentProviderControlGuardOptions {
  token: string
  webOrigin: string
  serverPort: number
  now: () => number
  rateWindowMs: number
  rateLimit: number
  invalidTokenRateLimit: number
}

function normalizedRemoteAddress(request: FastifyRequest): string {
  return request.ip || request.socket.remoteAddress || ''
}

function isLoopbackAddress(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0]
  return (
    normalized === '::1' ||
    normalized === '127.0.0.1' ||
    normalized.startsWith('127.') ||
    normalized.startsWith('::ffff:127.')
  )
}

function hostnameFromHostHeader(host: string): string | null {
  try {
    return new URL(`http://${host}`).hostname.toLowerCase()
  } catch {
    return null
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

export class AgentProviderControlGuard {
  readonly token: string
  private readonly options: AgentProviderControlGuardOptions
  private readonly attempts = new Map<string, number[]>()

  constructor(options: Partial<AgentProviderControlGuardOptions> = {}) {
    this.options = {
      token: options.token ?? crypto.randomBytes(32).toString('base64url'),
      webOrigin: options.webOrigin ?? config.webOrigin,
      serverPort: options.serverPort ?? config.port,
      now: options.now ?? Date.now,
      rateWindowMs: options.rateWindowMs ?? RATE_WINDOW_MS,
      rateLimit: options.rateLimit ?? RATE_LIMIT,
      invalidTokenRateLimit: options.invalidTokenRateLimit ?? INVALID_TOKEN_RATE_LIMIT
    }
    this.token = this.options.token
  }

  assertRead(request: FastifyRequest): void {
    const remoteAddress = normalizedRemoteAddress(request)
    if (!isLoopbackAddress(remoteAddress)) {
      throw new AgentProviderControlError(
        'agent_provider_control_local_only',
        'Agent Provider control is only available from the local machine.',
        403
      )
    }

    const host = request.headers.host
    const hostname = host ? hostnameFromHostHeader(host) : null
    let configuredHostname: string | null = null
    try {
      configuredHostname = new URL(this.options.webOrigin).hostname.toLowerCase()
    } catch {
      // Invalid WEB_ORIGIN must not broaden access.
    }
    if (!hostname || (!isLoopbackHostname(hostname) && hostname !== configuredHostname)) {
      throw new AgentProviderControlError(
        'invalid_control_host',
        'The request Host is not allowed for Agent Provider control.',
        403
      )
    }

    const origin = request.headers.origin
    if (origin && !this.isAllowedOrigin(origin)) {
      throw new AgentProviderControlError(
        'invalid_control_origin',
        'The request Origin is not allowed for Agent Provider control.',
        403
      )
    }
  }

  assertMutation(request: FastifyRequest, rateKey: string): void {
    this.assertRead(request)
    const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
    if (contentType !== 'application/json') {
      throw new AgentProviderControlError(
        'json_required',
        'Agent Provider mutations require application/json.',
        415
      )
    }

    const remoteAddress = normalizedRemoteAddress(request)
    if (!this.hasValidControlToken(request)) {
      this.assertRateLimit(`${remoteAddress}:invalid-token`, this.options.invalidTokenRateLimit)
      throw new AgentProviderControlError(
        'invalid_control_token',
        'A valid Agent Provider control token is required.',
        403
      )
    }
    this.assertRateLimit(`${remoteAddress}:authorized:${rateKey}`, this.options.rateLimit)
  }

  assertAuthorizedRead(request: FastifyRequest): void {
    this.assertRead(request)
    this.assertControlToken(request)
  }

  private isAllowedOrigin(origin: string): boolean {
    let parsed: URL
    let configured: URL
    try {
      parsed = new URL(origin)
      configured = new URL(this.options.webOrigin)
    } catch {
      return false
    }
    if (parsed.origin === configured.origin) {
      return true
    }
    if (!isLoopbackHostname(parsed.hostname.toLowerCase())) {
      return false
    }
    const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80
    const configuredWebPort = configured.port
      ? Number(configured.port)
      : configured.protocol === 'https:'
        ? 443
        : 80
    return port === this.options.serverPort || port === configuredWebPort
  }

  private assertRateLimit(key: string, limit: number): void {
    const now = this.options.now()
    const recent = (this.attempts.get(key) ?? []).filter(
      (timestamp) => now - timestamp < this.options.rateWindowMs
    )
    if (recent.length >= limit) {
      throw new AgentProviderControlError(
        'control_rate_limited',
        'Too many Agent Provider control requests. Try again shortly.',
        429
      )
    }
    recent.push(now)
    this.attempts.set(key, recent)

    // Loopback normally yields one or two keys, but prune expired entries so
    // spoofed test/proxy metadata cannot grow this map without bound.
    if (this.attempts.size > 16) {
      for (const [attemptKey, timestamps] of this.attempts) {
        if (!timestamps.some((timestamp) => now - timestamp < this.options.rateWindowMs)) {
          this.attempts.delete(attemptKey)
        }
      }
    }
  }

  private assertControlToken(request: FastifyRequest): void {
    if (!this.hasValidControlToken(request)) {
      throw new AgentProviderControlError(
        'invalid_control_token',
        'A valid Agent Provider control token is required.',
        403
      )
    }
  }

  private hasValidControlToken(request: FastifyRequest): boolean {
    const providedToken = request.headers['x-runcell-control-token']
    return typeof providedToken === 'string' && safeEqual(providedToken, this.token)
  }
}

export const agentProviderControlGuard = new AgentProviderControlGuard()
