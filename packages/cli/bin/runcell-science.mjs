#!/usr/bin/env node
// Launches the bundled Runcell Science workspace: boots the local server (which
// serves both the API and the built web app on one port), waits for it to become
// healthy, then opens the workspace in the browser and prints the URL.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(packageRoot, 'dist')
const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))

const DEFAULT_PORT = 27183
const DEFAULT_HOST = '127.0.0.1'

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR
const ESC = String.fromCharCode(27)
const paint = (code) => (s) => (useColor ? ESC + `[${code}m` + s + ESC + `[0m` : String(s))
const color = {
  bold: paint(1),
  cyan: paint(36),
  green: paint(32),
  yellow: paint(33),
  red: paint(31),
  dim: paint(2)
}

function info(message) {
  console.log(`${color.cyan('➜')} ${message}`)
}
function warn(message) {
  console.warn(`${color.yellow('warning:')} ${message}`)
}
function fail(message) {
  console.error(`${color.red('error:')} ${message}`)
  process.exit(1)
}

function printHelp() {
  console.log(`
${color.bold('runcell-science')} — launch the Runcell Science research workspace.

${color.bold('Usage')}
  npx runcell-science [options]

${color.bold('Options')}
  --port <n>       Port to serve the workspace on (default: ${DEFAULT_PORT}, or the
                   next free port if it is taken).
  --cwd <path>     Working directory the agent operates in (default: the current
                   directory).
  --host <addr>    Host to bind (default: ${DEFAULT_HOST}).
  --no-open        Do not open the browser automatically.
  -v, --version    Print the version and exit.
  -h, --help       Show this help and exit.

${color.bold('Requirements')}
  A signed-in Claude Code or Codex CLI on your PATH. Runcell reuses that session.

Data (sessions, SQLite, logs) is stored under ~/.runcell-science
(override with RUNCELL_SCIENCE_HOME).
`)
}

function parseArgs(argv) {
  const options = {
    port: undefined,
    cwd: process.cwd(),
    host: DEFAULT_HOST,
    open: process.env.RUNCELL_SCIENCE_NO_OPEN ? false : true
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    switch (arg) {
      case '-h':
      case '--help':
        printHelp()
        process.exit(0)
        break
      case '-v':
      case '--version':
        console.log(pkg.version)
        process.exit(0)
        break
      case '--no-open':
        options.open = false
        break
      case '--port': {
        const value = Number(argv[(i += 1)])
        if (!Number.isInteger(value) || value <= 0 || value >= 65536) {
          fail(`--port expects a number between 1 and 65535, got "${argv[i]}".`)
        }
        options.port = value
        break
      }
      case '--cwd':
        options.cwd = path.resolve(argv[(i += 1)] ?? '.')
        break
      case '--host':
        options.host = argv[(i += 1)] ?? DEFAULT_HOST
        break
      default:
        fail(`Unknown option: ${arg}\nRun "runcell-science --help" for usage.`)
    }
  }

  return options
}

// Mirrors scripts/dev.sh: Node 20.19+ or 22.12+ (Vite 8 / the toolchain need these).
function assertNodeVersion() {
  const [major, minor] = process.versions.node.split('.').map(Number)
  const ok = (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major > 22
  if (!ok) {
    fail(
      `Node ${process.versions.node} is not supported. Install Node 20.19+ or 22.12+ and try again.`
    )
  }
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

// Resolve a bare command name against PATH, honoring PATHEXT on Windows.
function findOnPath(command) {
  if (command.includes(path.sep) || command.includes('/')) {
    return isExecutable(command) ? command : null
  }

  const pathDirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : ['']

  for (const dir of pathDirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext)
      if (fs.existsSync(candidate) && (process.platform === 'win32' || isExecutable(candidate))) {
        return candidate
      }
    }
  }
  return null
}

// Warn (but do not block) if no agent runtime is installed — the workspace still
// opens; the user just can't start a session until a runtime is signed in.
function checkAgentRuntimes() {
  const codex = process.env.CODEX_BINARY_PATH?.trim() || 'codex'
  const claude = process.env.CLAUDE_CODE_BINARY_PATH?.trim() || 'claude'
  const hasCodex = Boolean(findOnPath(codex))
  const hasClaude = Boolean(findOnPath(claude))

  if (hasCodex || hasClaude) {
    const found = [hasClaude && 'Claude Code', hasCodex && 'Codex'].filter(Boolean).join(' and ')
    info(`Agent runtime detected: ${color.green(found)}.`)
    return
  }

  warn('No Claude Code or Codex runtime found on your PATH.')
  console.warn(
    color.dim(
      [
        '  Runcell reuses a signed-in agent CLI — install and sign in to one, then restart:',
        '    • Claude Code: https://claude.com/claude-code',
        '    • Codex:       https://developers.openai.com/codex/cli',
        '  The workspace will still open, but sessions cannot start until a runtime is available.'
      ].join('\n')
    )
  )
}

function canBind(port, host) {
  return new Promise((resolve) => {
    const tester = net.createServer()
    tester.once('error', () => resolve(false))
    tester.once('listening', () => tester.close(() => resolve(true)))
    tester.listen(port, host)
  })
}

function ephemeralPort(host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.once('listening', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port)
        else reject(new Error('Unable to allocate a free port.'))
      })
    })
    server.listen(0, host)
  })
}

async function resolvePort(preferred, host) {
  if (preferred !== undefined) {
    if (await canBind(preferred, host)) return preferred
    fail(`Port ${preferred} is already in use. Pass a different --port.`)
  }
  if (await canBind(DEFAULT_PORT, host)) return DEFAULT_PORT
  const fallback = await ephemeralPort(host)
  warn(`Port ${DEFAULT_PORT} is in use; using ${fallback} instead.`)
  return fallback
}

async function waitForHealth(baseUrl, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/healthz`)
      if (response.ok) return
    } catch (error) {
      lastError = error
    }
    await delay(250)
  }
  throw new Error(`Server did not become healthy at ${baseUrl}: ${String(lastError)}`)
}

function openBrowser(url) {
  const command =
    process.platform === 'darwin'
      ? { cmd: 'open', args: [url] }
      : process.platform === 'win32'
        ? { cmd: 'cmd', args: ['/c', 'start', '', url] }
        : { cmd: 'xdg-open', args: [url] }
  try {
    const child = spawn(command.cmd, command.args, { stdio: 'ignore', detached: true })
    child.on('error', () => {})
    child.unref()
  } catch {
    // Non-fatal: the URL is printed regardless.
  }
}

async function main() {
  assertNodeVersion()

  const serverEntry = path.join(distDir, 'server/index.mjs')
  if (!fs.existsSync(serverEntry)) {
    fail(
      `Bundle not found at ${serverEntry}.\nThis install looks incomplete — reinstall with "npm i -g runcell-science" or run via "npx runcell-science@latest".`
    )
  }

  const options = parseArgs(process.argv.slice(2))
  console.log(color.bold(`\nRuncell Science ${color.dim(`v${pkg.version}`)}\n`))

  checkAgentRuntimes()

  const port = await resolvePort(options.port, options.host)
  const url = `http://${options.host}:${port}`

  const dataHome =
    process.env.RUNCELL_SCIENCE_HOME?.trim() || path.join(os.homedir(), '.runcell-science')
  const dataDir = path.join(dataHome, 'data')

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    SERVER_HOST: options.host,
    SERVER_PORT: String(port),
    WEB_ORIGIN: url,
    STATIC_WEB_DIR: path.join(distDir, 'web'),
    MIGRATION_DIR: path.join(distDir, 'server/migrations'),
    // The server resolves nbcli / science-connectors relative to the workspace root.
    OPEN_SCIENCE_SERVER_ROOT: distDir,
    OPEN_SCIENCE_WORKSPACE_ROOT: distDir,
    SQLITE_PATH: path.join(dataDir, 'open-science.sqlite'),
    CHECKPOINT_GIT_DIR: path.join(dataDir, 'checkpoints.git'),
    LOG_DIR: path.join(dataHome, 'logs'),
    // The agent operates in the directory the user launched from.
    AGENT_DEFAULT_CWD: options.cwd,
    LOG_LEVEL: process.env.LOG_LEVEL?.trim() || 'warn'
  }

  info(`Workspace directory: ${color.dim(options.cwd)}`)
  info(`Local data:          ${color.dim(dataHome)}`)
  info('Starting the local server…')

  const server = spawn(process.execPath, [serverEntry], {
    env,
    stdio: ['ignore', 'inherit', 'inherit']
  })

  let shuttingDown = false
  const shutdown = (signal) => {
    if (shuttingDown) return
    shuttingDown = true
    if (server.exitCode === null) server.kill(signal === 'SIGINT' ? 'SIGINT' : 'SIGTERM')
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  server.on('exit', (code, signal) => {
    if (!shuttingDown && code !== 0) {
      fail(`The Runcell Science server exited unexpectedly (${signal ?? code}).`)
    }
    process.exit(code ?? 0)
  })

  try {
    await waitForHealth(url)
  } catch (error) {
    shutdown('SIGTERM')
    fail(error instanceof Error ? error.message : String(error))
  }

  console.log(`\n${color.green('✔')} ${color.bold('Runcell Science is ready.')}`)
  console.log(`  Open ${color.cyan(color.bold(url))}`)
  console.log(color.dim('  Press Ctrl-C to stop.\n'))

  if (options.open) openBrowser(url)
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
