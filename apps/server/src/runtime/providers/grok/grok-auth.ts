export const GROK_AUTH_METHOD_API_KEY = 'xai.api_key'
export const GROK_AUTH_METHOD_CACHED_TOKEN = 'cached_token'

/**
 * Keep auth-method selection in a leaf module so management-plane probes and
 * the session runtime share the same behavior without importing each other.
 */
export function resolveGrokAuthMethodId(env: NodeJS.ProcessEnv): string {
  return env.XAI_API_KEY?.trim() ? GROK_AUTH_METHOD_API_KEY : GROK_AUTH_METHOD_CACHED_TOKEN
}
