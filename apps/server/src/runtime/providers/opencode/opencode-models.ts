import type { AgentModelOption } from '@runcell-science/contracts'
import type { ProviderListResponse } from '@opencode-ai/sdk/v2'

import { config } from '../../../config/env'
import { assertOpenCodeCompatibility, connectOpenCodeServer } from './opencode-server'

const CACHE_TTL_MS = 5 * 60_000

let cached: { expiresAt: number; models: AgentModelOption[] } | null = null
let inFlight: Promise<AgentModelOption[]> | null = null

export function flattenOpenCodeModels(providerList: ProviderListResponse): AgentModelOption[] {
  const connected = new Set(providerList.connected)
  const options: AgentModelOption[] = [
    {
      provider: 'opencode',
      model: null,
      label: config.opencodeDefaultModel ? `Default (${config.opencodeDefaultModel})` : 'Default',
      hint: 'OpenCode configured default'
    }
  ]

  for (const provider of providerList.all) {
    if (!connected.has(provider.id)) continue
    for (const model of Object.values(provider.models)) {
      if (!model.id?.trim() || model.status === 'deprecated') continue
      options.push({
        provider: 'opencode',
        model: `${provider.id}/${model.id}`,
        label: model.name?.trim() || model.id,
        hint: provider.name?.trim() || provider.id
      })
    }
  }

  const [defaultOption, ...concrete] = options
  return [defaultOption!, ...concrete.sort((left, right) => left.label.localeCompare(right.label))]
}

async function loadOpenCodeModels(timeoutMs: number): Promise<AgentModelOption[]> {
  const deadline = Date.now() + timeoutMs
  const connection = await connectOpenCodeServer({ directory: config.agentDefaultCwd, timeoutMs })
  try {
    const client = connection.createClient(config.agentDefaultCwd)
    const signal = AbortSignal.timeout(Math.max(1, deadline - Date.now()))
    await assertOpenCodeCompatibility(client, signal)
    const response = await client.provider.list({ directory: config.agentDefaultCwd }, { signal })
    if (!response.data) throw new Error('OpenCode provider inventory was empty.')
    return flattenOpenCodeModels(response.data)
  } finally {
    await connection.dispose()
  }
}

export async function fetchOpenCodeModelOptions(timeoutMs = 15_000): Promise<AgentModelOption[]> {
  const now = Date.now()
  if (cached && cached.expiresAt > now) return cached.models.map((model) => ({ ...model }))
  if (inFlight) return inFlight

  inFlight = loadOpenCodeModels(timeoutMs)
    .then((models) => {
      cached = { expiresAt: Date.now() + CACHE_TTL_MS, models }
      return models.map((model) => ({ ...model }))
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

export function resetOpenCodeModelCache(): void {
  cached = null
  inFlight = null
}
