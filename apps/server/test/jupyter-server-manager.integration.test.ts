import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { JupyterServerManager } from '../src/services/jupyter-server-manager'

const spikePython = '/tmp/open-science-jupyter-spike-venv/bin/python'
const hasSpikePython = existsSync(spikePython)

if (!hasSpikePython) {
  console.log(`Skipping Jupyter integration test because ${spikePython} is missing.`)
}

function assertPortFree(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  })
}

test(
  'JupyterServerManager starts, reuses, and shuts down a real jupyter-server',
  { skip: hasSpikePython ? false : 'spike venv is missing', timeout: 90_000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'open-science-jupyter-integration-'))
    const workspace = path.join(root, 'workspace')
    const runtimeDir = path.join(root, 'runtime')
    const manager = new JupyterServerManager({
      jupyterPythonPath: spikePython,
      runtimeDir,
      disableReaper: true,
      webOrigin: 'http://localhost:27183'
    })

    try {
      await mkdir(workspace, { recursive: true })
      const connection = await manager.ensure(workspace)
      const statusUrl = `${connection.baseUrl}api/status`

      const authedStatus = await fetch(statusUrl, {
        headers: {
          Authorization: `token ${connection.token}`
        }
      })
      assert.equal(authedStatus.status, 200)

      const unauthenticatedStatus = await fetch(statusUrl)
      assert.equal(unauthenticatedStatus.status, 403)

      const sessionResponse = await fetch(`${connection.baseUrl}api/sessions`, {
        method: 'POST',
        headers: {
          Authorization: `token ${connection.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          kernel: { name: 'python3' },
          name: 't.ipynb',
          path: 't.ipynb',
          type: 'notebook'
        })
      })
      assert.equal(sessionResponse.ok, true)
      const sessionBody = await sessionResponse.json()
      assert.equal(typeof sessionBody.id, 'string')

      const reusedConnection = await manager.ensure(workspace)
      assert.equal(new URL(reusedConnection.baseUrl).port, new URL(connection.baseUrl).port)

      await manager.shutdown(workspace)
      await assertPortFree(Number(new URL(connection.baseUrl).port))
    } finally {
      await manager.disposeAll()
      await rm(root, { recursive: true, force: true })
    }
  }
)
