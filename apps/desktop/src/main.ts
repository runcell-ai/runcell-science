import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { app, BrowserWindow, dialog, shell } from 'electron'

const defaultServerPort = 27184

let mainWindow: BrowserWindow | null = null
let serverProcess: ChildProcessWithoutNullStreams | null = null
let isQuitting = false

function isDevelopment(): boolean {
  return !app.isPackaged
}

function repoRoot(): string {
  return path.resolve(app.getAppPath(), '../..')
}

async function canUsePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer()
    tester.once('error', () => resolve(false))
    tester.once('listening', () => {
      tester.close(() => resolve(true))
    })
    tester.listen(port, '127.0.0.1')
  })
}

async function resolveServerPort(): Promise<number> {
  if (await canUsePort(defaultServerPort)) {
    return defaultServerPort
  }

  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.once('listening', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') {
          resolve(address.port)
          return
        }
        reject(new Error('Unable to allocate a server port.'))
      })
    })
    server.listen(0, '127.0.0.1')
  })
}

function serverEntryPath(): string {
  if (isDevelopment()) {
    return path.join(app.getAppPath(), 'dist-server/index.mjs')
  }

  return path.join(process.resourcesPath, 'server/index.mjs')
}

function migrationsPath(): string {
  if (isDevelopment()) {
    return path.join(repoRoot(), 'apps/server/src/db/migrations')
  }

  return path.join(process.resourcesPath, 'server/migrations')
}

function staticWebPath(): string | undefined {
  if (process.env.OPEN_SCIENCE_DESKTOP_WEB_URL) {
    return undefined
  }

  return isDevelopment() ? path.join(repoRoot(), 'apps/web/dist') : path.join(process.resourcesPath, 'web')
}

async function waitForServer(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 20_000
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/healthz`)
      if (response.ok) {
        return
      }
    } catch (error) {
      lastError = error
    }
    await delay(250)
  }

  throw new Error(`Server did not become healthy at ${baseUrl}: ${String(lastError)}`)
}

function startServer(port: number): void {
  const entryPath = serverEntryPath()
  if (!fs.existsSync(entryPath)) {
    throw new Error(`Server entry not found at ${entryPath}. Run yarn --cwd apps/desktop build:server-bundle first.`)
  }

  const dataRoot = path.join(app.getPath('userData'), 'data')
  fs.mkdirSync(dataRoot, { recursive: true })

  const webDir = staticWebPath()
  const nodePath = path.join(app.getAppPath(), 'node_modules')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CHECKPOINT_GIT_DIR: path.join(dataRoot, 'checkpoints.git'),
    ELECTRON_RUN_AS_NODE: '1',
    LOG_DIR: path.join(app.getPath('userData'), 'logs'),
    MIGRATION_DIR: migrationsPath(),
    NODE_ENV: isDevelopment() ? 'development' : 'production',
    NODE_PATH: [process.env.NODE_PATH, nodePath].filter(Boolean).join(path.delimiter),
    OPEN_SCIENCE_SERVER_ROOT: isDevelopment() ? path.join(repoRoot(), 'apps/server') : process.resourcesPath,
    OPEN_SCIENCE_WORKSPACE_ROOT: isDevelopment() ? repoRoot() : process.resourcesPath,
    SERVER_HOST: '127.0.0.1',
    SERVER_PORT: String(port),
    SQLITE_PATH: path.join(dataRoot, 'open-science.sqlite'),
    WEB_ORIGIN: process.env.OPEN_SCIENCE_DESKTOP_WEB_URL ?? `http://127.0.0.1:${port}`
  }

  if (!env.AGENT_DEFAULT_CWD) {
    env.AGENT_DEFAULT_CWD = app.getPath('documents')
  }

  if (webDir) {
    env.STATIC_WEB_DIR = webDir
  }

  serverProcess = spawn(process.execPath, [entryPath], {
    env,
    stdio: 'pipe'
  })

  serverProcess.stdout.on('data', (data) => {
    process.stdout.write(`[server] ${data}`)
  })
  serverProcess.stderr.on('data', (data) => {
    process.stderr.write(`[server] ${data}`)
  })
  serverProcess.once('exit', (code, signal) => {
    serverProcess = null
    if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox('Runcell Science server stopped', `The local server exited with ${signal ?? code ?? 'unknown status'}.`)
    }
  })
}

function stopServer(): void {
  if (!serverProcess) {
    return
  }

  serverProcess.kill('SIGTERM')
  serverProcess = null
}

function createWindow(url: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 960,
    minHeight: 680,
    title: 'Runcell Science',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    void shell.openExternal(targetUrl)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, targetUrl) => {
    const currentOrigin = new URL(url).origin
    if (new URL(targetUrl).origin !== currentOrigin) {
      event.preventDefault()
      void shell.openExternal(targetUrl)
    }
  })

  void window.loadURL(url)
  return window
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  isQuitting = true
  stopServer()
})

app.whenReady().then(async () => {
  const port = await resolveServerPort()
  const appUrl = process.env.OPEN_SCIENCE_DESKTOP_WEB_URL ?? `http://127.0.0.1:${port}`

  startServer(port)
  await waitForServer(`http://127.0.0.1:${port}`)

  mainWindow = createWindow(appUrl)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow(appUrl)
    }
  })
}).catch((error) => {
  dialog.showErrorBox('Unable to start Runcell Science', error instanceof Error ? error.message : String(error))
  app.quit()
})
