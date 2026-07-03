import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { spawn } from 'node:child_process'
import test from 'node:test'

const execFileAsync = promisify(execFile)
const spikePython = '/tmp/open-science-jupyter-spike-venv/bin/python'
const nbcliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../nbcli.mjs')

async function pickPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close((error) => {
        if (error) reject(error)
        else if (address && typeof address === 'object') resolve(address.port)
        else reject(new Error('Failed to pick a port.'))
      })
    })
  })
}

async function waitForJupyter(baseUrl: string, token: string): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL('api/status', baseUrl), {
        headers: { Authorization: `token ${token}` }
      })
      if (response.status === 200) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Jupyter server did not become ready.')
}

async function startJupyter(workspace: string, runtimeRoot: string) {
  const port = await pickPort()
  const token = `test-token-${process.pid}-${Date.now()}`
  const baseUrl = `http://127.0.0.1:${port}/`
  const wsUrl = `ws://127.0.0.1:${port}/`
  const configDir = path.join(runtimeRoot, 'config')
  const runtimeDir = path.join(runtimeRoot, 'runtime')
  await mkdir(configDir, { recursive: true })
  await mkdir(runtimeDir, { recursive: true })

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
        JUPYTER_RUNTIME_DIR: runtimeDir
      },
      stdio: ['ignore', 'ignore', 'ignore']
    }
  )

  await waitForJupyter(baseUrl, token)
  return { child, baseUrl, wsUrl, token }
}

async function startStubApi(connection: { baseUrl: string; wsUrl: string; token: string }) {
  const server = http.createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/api/jupyter/workspace') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(connection))
      return
    }
    response.writeHead(404, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: { code: 'not_found', message: 'not found' } }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return {
    apiUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

async function jupyterFetch(connection: { baseUrl: string; token: string }, resource: string, init: RequestInit = {}) {
  const response = await fetch(new URL(resource, connection.baseUrl), {
    ...init,
    headers: {
      Authorization: `token ${connection.token}`,
      ...(init.headers ?? {})
    }
  })
  const body = await response.json()
  assert.equal(response.ok, true, JSON.stringify(body))
  return body
}

async function runNbcli(workspace: string, apiUrl: string, args: string[]) {
  try {
    const result = await execFileAsync(process.execPath, [nbcliPath, ...args], {
      cwd: workspace,
      env: { ...process.env, OPEN_SCIENCE_API_URL: apiUrl },
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024
    })
    return { code: 0, stdout: result.stdout, stderr: result.stderr }
  } catch (error: any) {
    return {
      code: typeof error.code === 'number' ? error.code : 1,
      stdout: String(error.stdout ?? ''),
      stderr: String(error.stderr ?? '')
    }
  }
}

test('nbcli shares a real Jupyter kernel and persists exec-cell outputs', { timeout: 120_000 }, async () => {
  assert.equal(existsSync(spikePython), true, `${spikePython} must exist for nbcli integration tests.`)

  const root = await mkdtemp(path.join(os.tmpdir(), 'open-science-nbcli-integration-'))
  const workspace = path.join(root, 'workspace')
  const runtimeRoot = path.join(root, 'runtime')
  let jupyter: Awaited<ReturnType<typeof startJupyter>> | null = null
  let stub: Awaited<ReturnType<typeof startStubApi>> | null = null

  try {
    await mkdir(workspace, { recursive: true })
    const notebook = {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: { custom: { keep: true } },
      cells: [
        {
          id: 'plot-cell',
          cell_type: 'code',
          source: [
            'print("plot text")\n',
            'import matplotlib\n',
            'matplotlib.use("Agg")\n',
            'import matplotlib.pyplot as plt\n',
            'from io import BytesIO\n',
            'from IPython.display import Image, display\n',
            'fig, ax = plt.subplots()\n',
            'ax.plot([1, 2, 3], [1, 4, 9])\n',
            'buf = BytesIO()\n',
            'fig.savefig(buf, format="png")\n',
            'display(Image(data=buf.getvalue()))\n',
            'plt.close(fig)\n'
          ],
          metadata: { unknown: { keep: true } },
          execution_count: null,
          outputs: [],
          custom_cell_field: { keep: ['x', 'x'] }
        },
        {
          id: 'error-cell',
          cell_type: 'code',
          source: ['raise ValueError("nbcli boom")\n'],
          metadata: { unknown: 'keep' },
          execution_count: null,
          outputs: [],
          custom_cell_field: { nested: [{ a: 1 }, { a: 1 }] }
        }
      ],
      custom_top_level: { keep: true }
    }
    await writeFile(path.join(workspace, 't.ipynb'), `${JSON.stringify(notebook, null, 2)}\n`)

    jupyter = await startJupyter(workspace, runtimeRoot)
    stub = await startStubApi(jupyter)

    await jupyterFetch(jupyter, 'api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 't.ipynb', name: 't.ipynb', type: 'notebook', kernel: { name: 'python3' } })
    })

    const assign = await runNbcli(workspace, stub.apiUrl, ['exec-code', '--notebook', 't.ipynb', 'x = 41'])
    assert.equal(assign.code, 0, assign.stderr)
    const print = await runNbcli(workspace, stub.apiUrl, ['exec-code', '--notebook', 't.ipynb', 'print(x + 1)'])
    assert.equal(print.code, 0, print.stderr)
    assert.match(print.stdout, /42/)

    const sessions = await jupyterFetch(jupyter, 'api/sessions')
    assert.equal(sessions.filter((session: any) => session.path === 't.ipynb' && session.type === 'notebook').length, 1)

    const plot = await runNbcli(workspace, stub.apiUrl, [
      'exec-cell',
      '--notebook',
      't.ipynb',
      '--cell',
      'plot-cell'
    ])
    assert.equal(plot.code, 0, plot.stderr)
    assert.match(plot.stdout, /plot text/)
    assert.match(plot.stdout, /\[image\/png output: \d+ bytes base64\]/)

    let saved = JSON.parse(await readFile(path.join(workspace, 't.ipynb'), 'utf8'))
    const plotCell = saved.cells.find((cell: any) => cell.id === 'plot-cell')
    assert.equal(saved.custom_top_level.keep, true)
    assert.deepEqual(plotCell.custom_cell_field, { keep: ['x', 'x'] })
    assert.equal(typeof plotCell.execution_count, 'number')
    assert.ok(plotCell.outputs.some((output: any) => output.output_type === 'stream' && /plot text/.test(output.text)))
    assert.ok(plotCell.outputs.some((output: any) => output.data?.['image/png']))

    const error = await runNbcli(workspace, stub.apiUrl, [
      'exec-cell',
      '--notebook',
      't.ipynb',
      '--cell',
      'error-cell'
    ])
    assert.equal(error.code, 1)
    assert.match(error.stderr, /ValueError/)
    assert.match(error.stderr, /nbcli boom/)

    saved = JSON.parse(await readFile(path.join(workspace, 't.ipynb'), 'utf8'))
    const errorCell = saved.cells.find((cell: any) => cell.id === 'error-cell')
    assert.deepEqual(errorCell.custom_cell_field, { nested: [{ a: 1 }, { a: 1 }] })
    assert.ok(errorCell.outputs.some((output: any) => output.output_type === 'error' && output.ename === 'ValueError'))
  } finally {
    if (stub) await stub.close()
    if (jupyter) {
      jupyter.child.kill('SIGTERM')
      await new Promise((resolve) => setTimeout(resolve, 1000))
      if (jupyter.child.exitCode === null && jupyter.child.signalCode === null) jupyter.child.kill('SIGKILL')
    }
    await rm(root, { recursive: true, force: true })
  }
})
