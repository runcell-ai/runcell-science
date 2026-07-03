import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import { JupyterServerManager, workspaceKernelName } from '../src/services/jupyter-server-manager'

const execFileAsync = promisify(execFile)
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

async function purelibOf(python: string): Promise<string> {
  const { stdout } = await execFileAsync(python, ['-c', "import sysconfig; print(sysconfig.get_paths()['purelib'])"])
  return stdout.trim()
}

/**
 * A minimal "project env": a distinct interpreter path whose site-packages
 * borrows the spike venv's installed packages via a .pth file. This keeps the
 * test offline while still proving kernels launch on the PROJECT python, not
 * on the runtime env that hosts jupyter-server.
 */
async function createProjectEnv(dir: string): Promise<string> {
  await execFileAsync(spikePython, ['-m', 'venv', '--without-pip', dir], { timeout: 60_000 })
  const python = path.join(dir, 'bin', 'python')
  const sitePackages = await purelibOf(python)
  await writeFile(path.join(sitePackages, 'borrow-spike.pth'), `${await purelibOf(spikePython)}\n`)
  return python
}

/** Minimal classic-wire-protocol execute over the kernel channels WebSocket. */
async function executeViaWs(connection: { wsUrl: string; token: string }, kernelId: string, code: string): Promise<string> {
  const wsSession = crypto.randomUUID()
  const url = new URL(`api/kernels/${kernelId}/channels`, connection.wsUrl)
  url.searchParams.set('session_id', wsSession)
  url.searchParams.set('token', connection.token)
  const ws = new WebSocket(url)
  const msgId = crypto.randomUUID()

  return new Promise((resolve, reject) => {
    let streamText = ''
    let gotReply = false
    let gotIdle = false
    const timeout = setTimeout(() => {
      ws.close()
      reject(new Error('WS execute timed out.'))
    }, 30_000)

    ws.addEventListener('error', () => {
      clearTimeout(timeout)
      reject(new Error('Kernel WebSocket failed to open.'))
    })
    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          header: {
            msg_id: msgId,
            username: 'test',
            session: wsSession,
            date: new Date().toISOString(),
            msg_type: 'execute_request',
            version: '5.3'
          },
          parent_header: {},
          metadata: {},
          content: { code, silent: false, store_history: true, user_expressions: {}, allow_stdin: false, stop_on_error: false },
          channel: 'shell'
        })
      )
    })
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as {
        channel?: string
        header?: { msg_type?: string }
        parent_header?: { msg_id?: string }
        content?: { name?: string; text?: string; execution_state?: string }
      }
      if (message.parent_header?.msg_id !== msgId) {
        return
      }
      if (message.channel === 'iopub' && message.header?.msg_type === 'stream') {
        streamText += message.content?.text ?? ''
      }
      if (message.channel === 'iopub' && message.header?.msg_type === 'status' && message.content?.execution_state === 'idle') {
        gotIdle = true
      }
      if (message.channel === 'shell' && message.header?.msg_type === 'execute_reply') {
        gotReply = true
      }
      if (gotReply && gotIdle) {
        clearTimeout(timeout)
        ws.close()
        resolve(streamText)
      }
    })
  })
}

test(
  'jupyter-server runs on the runtime env while kernels run on the project python',
  { skip: hasSpikePython ? false : 'spike venv is missing', timeout: 120_000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'open-science-jupyter-integration-'))
    const workspace = path.join(root, 'workspace')
    const runtimeDir = path.join(root, 'runtime')
    const projectEnvDir = path.join(root, 'project-env')
    await mkdir(workspace, { recursive: true })
    const projectPython = await createProjectEnv(projectEnvDir)
    assert.notEqual(projectPython, spikePython)

    const manager = new JupyterServerManager({
      jupyterPythonPath: projectPython,
      // Spike venv provides jupyter-server; skips network provisioning in tests.
      jupyterServerPythonPath: spikePython,
      runtimeDir,
      disableReaper: true,
      webOrigin: 'http://localhost:27183'
    })

    try {
      const status = await manager.status(workspace)
      assert.equal(status.runtime.ready, true)
      assert.deepEqual(status.python, { pythonPath: projectPython, hasIpykernel: true })

      const connection = await manager.ensure(workspace)
      const statusUrl = `${connection.baseUrl}api/status`

      const authedStatus = await fetch(statusUrl, {
        headers: { Authorization: `token ${connection.token}` }
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
          kernel: { name: workspaceKernelName },
          name: 't.ipynb',
          path: 't.ipynb',
          type: 'notebook'
        })
      })
      assert.equal(sessionResponse.ok, true)
      const sessionBody = (await sessionResponse.json()) as { id?: string; kernel?: { id?: string } }
      assert.equal(typeof sessionBody.id, 'string')
      const kernelId = sessionBody.kernel?.id
      assert.equal(typeof kernelId, 'string')

      // The architecture proof: the kernel's interpreter is the PROJECT
      // python, not the runtime env python that hosts jupyter-server.
      // realpathSync both sides: macOS tmpdir is /var -> /private/var.
      const executable = (await executeViaWs(connection, kernelId as string, 'import sys; print(sys.executable)')).trim()
      assert.equal(realpathSync(executable), realpathSync(projectPython))

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
