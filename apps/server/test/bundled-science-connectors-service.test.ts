import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

process.env.SQLITE_PATH = path.join(os.tmpdir(), `open-science-bundled-connectors-${process.pid}.sqlite`)
process.env.CHECKPOINT_GIT_DIR = path.join(os.tmpdir(), `open-science-bundled-connectors-checkpoints-${process.pid}.git`)
process.env.LOG_LEVEL = 'silent'

const [{ runMigrations }, { closeDb, getDb }, { bundledScienceConnectorsService }] = await Promise.all([
  import('../src/db/migrate'),
  import('../src/db/connection'),
  import('../src/services/bundled-science-connectors-service')
])

test.before(async () => {
  await runMigrations()
})

test.beforeEach(() => {
  getDb().prepare('DELETE FROM bundled_science_connector_enablement').run()
})

test.after(() => {
  closeDb()
})

test('bundled science connector enablement is project scoped and produces MCP configs', () => {
  const cwd = path.join(os.tmpdir(), 'open-science-project')
  const otherCwd = path.join(os.tmpdir(), 'open-science-other-project')

  const initial = bundledScienceConnectorsService.listConnectors(cwd)
  assert.ok(initial.connectors.length >= 22)
  const connectorName = 'biomart'
  assert.ok(initial.connectors.some((connector) => connector.name === connectorName))
  assert.equal(initial.connectors.find((connector) => connector.name === connectorName)?.enabled, false)
  assert.equal(initial.connectors.find((connector) => connector.name === 'ketcher-chemistry')?.enabled, true)

  bundledScienceConnectorsService.setEnabled({ cwd, name: connectorName, enabled: true })

  const enabled = bundledScienceConnectorsService.listConnectors(cwd)
  const other = bundledScienceConnectorsService.listConnectors(otherCwd)
  assert.equal(enabled.connectors.find((connector) => connector.name === connectorName)?.enabled, true)
  assert.equal(other.connectors.find((connector) => connector.name === connectorName)?.enabled, false)

  const configs = bundledScienceConnectorsService.getEnabledMcpConfigs(cwd)
  const config = configs[connectorName]
  assert.equal(config?.type, 'stdio')
  assert.equal(config?.command, 'node')
  assert.ok(config?.args?.[0]?.endsWith('packages/science-connectors/dist/cli.js'))
  assert.deepEqual(config?.args?.slice(1), ['connector', connectorName])
  assert.equal(configs['ketcher-chemistry']?.type, 'stdio')

  const disabledForSession = bundledScienceConnectorsService.getEnabledMcpConfigs(cwd, [connectorName])
  assert.equal(disabledForSession[connectorName], undefined)
  assert.equal(disabledForSession['ketcher-chemistry']?.type, 'stdio')

  const ketcherDisabledForSession = bundledScienceConnectorsService.getEnabledMcpConfigs(cwd, ['ketcher-chemistry'])
  assert.equal(ketcherDisabledForSession['ketcher-chemistry'], undefined)

  bundledScienceConnectorsService.setEnabled({ cwd, name: 'ketcher-chemistry', enabled: false })
  const afterKetcherDisable = bundledScienceConnectorsService.listConnectors(cwd)
  assert.equal(afterKetcherDisable.connectors.find((connector) => connector.name === 'ketcher-chemistry')?.enabled, false)
  assert.equal(bundledScienceConnectorsService.getEnabledMcpConfigs(cwd)['ketcher-chemistry'], undefined)
})
