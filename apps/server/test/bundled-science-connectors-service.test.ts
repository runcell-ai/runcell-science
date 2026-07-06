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
  assert.equal(initial.connectors.find((connector) => connector.name === 'biomart')?.enabled, false)

  bundledScienceConnectorsService.setEnabled({ cwd, name: 'biomart', enabled: true })

  const enabled = bundledScienceConnectorsService.listConnectors(cwd)
  const other = bundledScienceConnectorsService.listConnectors(otherCwd)
  assert.equal(enabled.connectors.find((connector) => connector.name === 'biomart')?.enabled, true)
  assert.equal(other.connectors.find((connector) => connector.name === 'biomart')?.enabled, false)

  const configs = bundledScienceConnectorsService.getEnabledMcpConfigs(cwd)
  assert.equal(configs.biomart?.type, 'stdio')
  assert.equal(configs.biomart?.command, 'node')
  assert.ok(configs.biomart?.args?.[0]?.endsWith('packages/science-connectors/dist/cli.js'))
  assert.deepEqual(configs.biomart?.args?.slice(1), ['connector', 'biomart'])

  const disabledForSession = bundledScienceConnectorsService.getEnabledMcpConfigs(cwd, ['biomart'])
  assert.equal(disabledForSession.biomart, undefined)
})
