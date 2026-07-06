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
  const connectorName = initial.connectors[0]?.name
  assert.ok(connectorName)
  assert.equal(initial.connectors.find((connector) => connector.name === connectorName)?.enabled, false)

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

  const disabledForSession = bundledScienceConnectorsService.getEnabledMcpConfigs(cwd, [connectorName])
  assert.equal(disabledForSession[connectorName], undefined)
})
