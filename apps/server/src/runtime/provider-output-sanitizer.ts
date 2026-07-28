import os from 'node:os'

function sensitiveEnvironmentValues(env: NodeJS.ProcessEnv): string[] {
  return Object.entries(env)
    .filter(([key, value]) =>
      typeof value === 'string' &&
      value.length >= 4 &&
      /(?:TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|COOKIE|SESSION)/i.test(key)
    )
    .map(([, value]) => value as string)
    .sort((left, right) => right.length - left.length)
}

function rawMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message
  }
  try {
    if (typeof value === 'string') {
      return value
    }
    const serialized = JSON.stringify(value)
    return serialized === undefined ? String(value) : serialized
  } catch {
    return String(value)
  }
}

/**
 * Sanitizes every provider-controlled string before it crosses into a DTO,
 * log/event stream, or user-visible error. Protocol payloads themselves must
 * remain untouched and are not passed through this helper.
 */
export function sanitizeProviderOutput(
  value: unknown,
  env: NodeJS.ProcessEnv = process.env,
  maxLength = 500
): string {
  let scrubbed = rawMessage(value).replaceAll(os.homedir(), '~')
  for (const secret of sensitiveEnvironmentValues(env)) {
    scrubbed = scrubbed.split(secret).join('[redacted]')
  }
  return scrubbed
    .replace(/\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted-jwt]')
    .replace(/\b(?:sk|xai|anthropic|bearer)[-_][A-Za-z0-9._-]{12,}\b/gi, '[redacted]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\u2060\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}
