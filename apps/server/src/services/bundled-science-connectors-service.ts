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

function enabledNamesForCwd(cwd: string): Set<string> {
  const rows = getDb()
    .prepare(
      `
        SELECT connector_name, cwd, enabled
        FROM bundled_science_connector_enablement
        WHERE cwd = ?
          AND enabled = 1
      `
    )
    .all(normalizedCwd(cwd)) as EnablementRow[]

  return new Set(rows.map((row) => row.connector_name))
}

function connectorCliPath(): string {
  return path.join(config.workspaceRoot, 'packages/science-connectors/dist/cli.js')
}

function toMcpConfig(name: string): McpServerConfigInput {
  return {
    type: 'stdio',
    command: 'node',
    args: [connectorCliPath(), 'connector', name]
  }
}

export class BundledScienceConnectorsService {
  listConnectors(cwd: string): ListBundledScienceConnectorsResponse {
    const enabled = enabledNamesForCwd(cwd)
    return {
      connectors: bundledScienceConnectors.map((connector) => ({
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
        enabled: enabled.has(connector.name),
        scope: 'project'
      })) satisfies BundledScienceConnectorView[]
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

  getEnabledMcpConfigs(cwd: string, disabledServers: string[] = []): Record<string, McpServerConfigInput> {
    const enabled = enabledNamesForCwd(cwd)
    const disabled = new Set(disabledServers)
    const configs: Record<string, McpServerConfigInput> = {}
    for (const connector of bundledScienceConnectors) {
      if (enabled.has(connector.name) && !disabled.has(connector.name)) {
        configs[connector.name] = toMcpConfig(connector.name)
      }
    }
    return configs
  }
}

export const bundledScienceConnectorsService = new BundledScienceConnectorsService()
