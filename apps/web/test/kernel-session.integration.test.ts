import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { KernelSession } from '../src/notebook/kernel-session'
import type { JupyterConnection } from '../src/notebook/kernel-session'
import type { NotebookRawOutput } from '../src/notebook/notebook-doc'

const spikePython = '/tmp/open-science-jupyter-spike-venv/bin/python'
const hasSpikePython = existsSync(spikePython)

if (!hasSpikePython) {
  console.log(`Skipping Jupyter kernel integration test because ${spikePython} is missing.`)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function pickPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        if (address && typeof address === 'object') {
          resolve(address.port)
          return
        }
        reject(new Error('Failed to allocate a local port.'))
      })
    })
  })
}

async function waitForReady(connection: JupyterConnection, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('Jupyter server exited before it was ready.')
    }
    try {
      const response = await fetch(`${connection.baseUrl}api/status`, {
        headers: { Authorization: `token ${connection.token}` },
        signal: AbortSignal.timeout(1_000)
      })
      if (response.status === 200) {
        return
      }
    } catch {
      // Retry until readiness timeout.
    }
    await delay(250)
  }
  throw new Error('Timed out waiting for Jupyter server readiness.')
}

async function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }
  child.kill('SIGTERM')
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  await Promise.race([
    exited,
    delay(3_000).then(() => {
      child.kill('SIGKILL')
    })
  ])
}

async function startJupyter(workspace: string, runtimeDir: string): Promise<{ connection: JupyterConnection; child: ChildProcess }> {
  const port = await pickPort()
  const token = randomBytes(24).toString('hex')
  const connection = {
    baseUrl: `http://127.0.0.1:${port}/`,
    wsUrl: `ws://127.0.0.1:${port}/`,
    token
  }
  const configDir = path.join(runtimeDir, 'config')
  const runtimeFilesDir = path.join(runtimeDir, 'runtime')
  const dataDir = path.join(runtimeDir, 'data')
  await mkdir(configDir, { recursive: true })
  await mkdir(runtimeFilesDir, { recursive: true })
  // Mirror the manager's per-workspace kernelspec: KernelSession requests the
  // 'open-science-python' kernel, so the test server must expose it.
  const kernelDir = path.join(dataDir, 'kernels', 'open-science-python')
  await mkdir(kernelDir, { recursive: true })
  await writeFile(
    path.join(kernelDir, 'kernel.json'),
    JSON.stringify({
      argv: [spikePython, '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
      display_name: 'Python (workspace)',
      language: 'python'
    })
  )

  const child = spawn(
    spikePython,
    [
      '-m',
      'jupyter_server',
      '--ServerApp.ip=127.0.0.1',
      `--ServerApp.port=${port}`,
      '--ServerApp.port_retries=0',
      `--IdentityProvider.token=${token}`,
      '--ServerApp.open_browser=False',
      '--ServerApp.allow_origin=http://localhost:27183',
      `--ServerApp.root_dir=${workspace}`,
      '--ServerApp.terminals_enabled=False'
    ],
    {
      cwd: workspace,
      env: {
        ...process.env,
        JUPYTER_CONFIG_DIR: configDir,
        JUPYTER_RUNTIME_DIR: runtimeFilesDir,
        JUPYTER_PATH: dataDir
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )

  await waitForReady(connection, child)
  return { connection, child }
}

function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    delay(ms).then(() => {
      throw new Error(`Timed out after ${ms}ms`)
    })
  ])
}

test(
  'KernelSession executes cells, interrupts, and reuses sessions by notebook path',
  { skip: hasSpikePython ? false : 'spike venv is missing', timeout: 90_000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'open-science-web-kernel-'))
    const workspace = path.join(root, 'workspace')
    const runtimeDir = path.join(root, 'runtime')
    let child: ChildProcess | null = null
    let first: KernelSession | null = null
    let second: KernelSession | null = null

    try {
      await mkdir(workspace, { recursive: true })
      await writeFile(
        path.join(workspace, 'analysis.ipynb'),
        JSON.stringify({ cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 })
      )
      const started = await startJupyter(workspace, runtimeDir)
      child = started.child

      first = await KernelSession.connect({
        connection: started.connection,
        path: 'analysis.ipynb',
        WebSocket: globalThis.WebSocket
      })
      assert.equal(typeof first.kernelId, 'string')

      const streamOutputs: NotebookRawOutput[] = []
      const printStatus = await first.executeCell('print(1)', {
        onOutput: (output) => streamOutputs.push(output)
      })
      assert.equal(printStatus, 'ok')
      assert.deepEqual(streamOutputs.find((output) => output.output_type === 'stream'), {
        output_type: 'stream',
        name: 'stdout',
        text: '1\n'
      })

      const errorOutputs: NotebookRawOutput[] = []
      const errorStatus = await first.executeCell('raise ValueError("bad")', {
        onOutput: (output) => errorOutputs.push(output)
      })
      assert.equal(errorStatus, 'error')
      assert.equal(errorOutputs.some((output) => output.output_type === 'error' && output.ename === 'ValueError'), true)

      const sleeping = first.executeCell('import time; time.sleep(30)')
      await delay(1_000)
      await first.interrupt()
      await timeout(sleeping, 15_000)

      second = await KernelSession.connect({
        connection: started.connection,
        path: 'analysis.ipynb',
        WebSocket: globalThis.WebSocket
      })
      assert.equal(second.kernelId, first.kernelId)
    } finally {
      second?.dispose()
      first?.dispose()
      if (child) {
        await terminate(child)
      }
      await rm(root, { recursive: true, force: true })
    }
  }
)
