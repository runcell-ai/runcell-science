import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { JupyterEnvMissingError, JupyterServerManager } from '../src/services/jupyter-server-manager'

async function makeExecutable(filePath: string, contents: string): Promise<void> {
  await writeFile(filePath, contents)
  await chmod(filePath, 0o755)
}

test('python resolution prefers configured path, then workspace venv, then PATH python3', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-science-jupyter-resolution-'))
  try {
    const workspace = path.join(root, 'workspace')
    const venvBin = path.join(workspace, '.venv', 'bin')
    const pathBin = path.join(root, 'bin')
    await mkdir(venvBin, { recursive: true })
    await mkdir(pathBin, { recursive: true })

    const configuredPython = path.join(root, 'configured-python')
    const venvPython = path.join(venvBin, 'python')
    const pathPython = path.join(pathBin, 'python3')
    await makeExecutable(configuredPython, '#!/bin/sh\nexit 0\n')
    await makeExecutable(venvPython, '#!/bin/sh\nexit 0\n')
    await makeExecutable(pathPython, '#!/bin/sh\nexit 0\n')

    const configured = new JupyterServerManager({
      jupyterPythonPath: configuredPython,
      env: { PATH: pathBin },
      disableReaper: true
    })
    assert.equal(configured.resolvePythonPath(workspace), configuredPython)
    await configured.disposeAll()

    const venv = new JupyterServerManager({
      env: { PATH: pathBin },
      disableReaper: true
    })
    assert.equal(venv.resolvePythonPath(workspace), venvPython)
    await venv.disposeAll()

    await rm(path.join(workspace, '.venv'), { recursive: true, force: true })
    const pathOnly = new JupyterServerManager({
      env: { PATH: pathBin },
      disableReaper: true
    })
    assert.equal(pathOnly.resolvePythonPath(workspace), pathPython)
    await pathOnly.disposeAll()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('workspace registry keys use the realpath of the cwd', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-science-jupyter-realpath-'))
  try {
    const workspace = path.join(root, 'workspace')
    const linkedWorkspace = path.join(root, 'workspace-link')
    await mkdir(workspace, { recursive: true })
    await symlink(workspace, linkedWorkspace)

    const manager = new JupyterServerManager({ disableReaper: true })
    assert.equal(manager.resolveWorkspaceKey(linkedWorkspace), manager.resolveWorkspaceKey(workspace))
    await manager.disposeAll()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('ensure throws a typed error when the configured python is missing Jupyter modules', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-science-jupyter-missing-'))
  try {
    const workspace = path.join(root, 'workspace')
    const runtimeDir = path.join(root, 'runtime')
    const fakePython = path.join(root, 'python')
    await mkdir(workspace, { recursive: true })
    await makeExecutable(
      fakePython,
      `#!/bin/sh
case "$2" in
  *jupyter_server*) exit 1 ;;
  *ipykernel*) exit 0 ;;
esac
exit 0
`
    )

    const manager = new JupyterServerManager({
      jupyterPythonPath: fakePython,
      runtimeDir,
      disableReaper: true
    })

    await assert.rejects(
      () => manager.ensure(workspace),
      (error) => {
        assert.ok(error instanceof JupyterEnvMissingError)
        assert.deepEqual(error.status, {
          pythonPath: fakePython,
          hasJupyterServer: false,
          hasIpykernel: true
        })
        return true
      }
    )
    await manager.disposeAll()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
