import path from 'node:path'

import { bundledScienceConnectors, findBundledScienceConnector } from '@open-science/science-connectors'
import type {
  BundledScienceConnectorView,
  ListBundledScienceConnectorsResponse,
  McpServerConfigInput
} from '@open-science/contracts'

import { config } from '../config/env'
import { getDb } from '../db/connection'
import { McpManagementError } from './mcp-management-service'

interface EnablementRow {
  connector_name: string
  cwd: string
  enabled: number
}

function nowIso(): string {
  return new Date().toISOString()
}

function normalizedCwd(cwd: string): string {
  return path.resolve(cwd)
}

function enablementOverridesForCwd(cwd: string): Map<string, boolean> {
  const rows = getDb()
    .prepare(
      `
        SELECT connector_name, cwd, enabled
        FROM bundled_science_connector_enablement
        WHERE cwd = ?
      `
    )
    .all(normalizedCwd(cwd)) as EnablementRow[]

  return new Map(rows.map((row) => [row.connector_name, row.enabled === 1]))
}

function connectorCliPath(): string {
  return path.join(config.workspaceRoot, 'packages/science-connectors/dist/cli.js')
}

function connectorEnv(sessionId?: string): Record<string, string> {
  return {
    OPEN_SCIENCE_API_URL: `http://127.0.0.1:${config.port}`,
    OPEN_SCIENCE_NBCLI: path.join(config.workspaceRoot, 'packages/nbcli/nbcli.mjs'),
    ...(sessionId ? { OPEN_SCIENCE_SESSION_ID: sessionId } : {})
  }
}

function toMcpConfig(name: string, sessionId?: string): McpServerConfigInput {
  return {
    type: 'stdio',
    command: 'node',
    args: [connectorCliPath(), 'connector', name],
    env: connectorEnv(sessionId)
  }
}

export class BundledScienceConnectorsService {
  listConnectors(cwd: string): ListBundledScienceConnectorsResponse {
    const overrides = enablementOverridesForCwd(cwd)
    return {
      connectors: bundledScienceConnectors.map((connector) => {
        const override = overrides.get(connector.name)
        return {
          id: connector.id,
          name: connector.name,
          displayName: connector.displayName,
          description: connector.description,
          batch: connector.batch,
          transport: connector.transport,
          auth: connector.auth,
          upstreams: connector.upstreams,
          status: connector.status,
          toolCount: connector.toolCount,
          enabled: override ?? connector.defaultEnabled === true,
          scope: 'project'
        }
      }) satisfies BundledScienceConnectorView[]
    }
  }

  setEnabled(input: { cwd: string; name: string; enabled: boolean }): void {
    const connector = findBundledScienceConnector(input.name)
    if (!connector) {
      throw new McpManagementError('unknown_bundled_connector', 'Unknown bundled science connector.', 404)
    }

    const timestamp = nowIso()
    getDb()
      .prepare(
        `
          INSERT INTO bundled_science_connector_enablement (connector_name, cwd, enabled, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(connector_name, cwd) DO UPDATE SET
            enabled = excluded.enabled,
            updated_at = excluded.updated_at
        `
      )
      .run(connector.name, normalizedCwd(input.cwd), input.enabled ? 1 : 0, timestamp, timestamp)
  }

  getEnabledMcpConfigs(
    cwd: string,
    disabledServers: string[] = [],
    sessionId?: string
  ): Record<string, McpServerConfigInput> {
    const overrides = enablementOverridesForCwd(cwd)
    const disabled = new Set(disabledServers)
    const configs: Record<string, McpServerConfigInput> = {}
    for (const connector of bundledScienceConnectors) {
      const enabled = overrides.get(connector.name) ?? connector.defaultEnabled === true
      if (enabled && !disabled.has(connector.name)) {
        configs[connector.name] = toMcpConfig(connector.name, sessionId)
      }
    }
    return configs
  }
}

export const bundledScienceConnectorsService = new BundledScienceConnectorsService()
