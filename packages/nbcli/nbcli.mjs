#!/usr/bin/env node
// @ts-check

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import process from 'node:process'

const defaultTimeoutSeconds = 300

function usage(command = '') {
  const common = '[--api-url <url>] [--cwd <path>]'
  if (command === 'status') return `Usage: nbcli status ${common}`
  if (command === 'exec-code') {
    return `Usage: nbcli exec-code ${common} --notebook <path> [--timeout <sec>] <code...>\n       nbcli exec-code ${common} --notebook <path> -`
  }
  if (command === 'exec-cell') {
    return `Usage: nbcli exec-cell ${common} --notebook <path> --cell <cell-id> [--timeout <sec>]`
  }
  return `Usage: nbcli <command> ${common}\n\nCommands:\n  status\n  exec-code --notebook <path> [--timeout <sec>] <code...>\n  exec-cell --notebook <path> --cell <cell-id> [--timeout <sec>]`
}

function die(message, code = 2) {
  console.error(message)
  process.exit(code)
}

export function parseArgs(argv) {
  const args = [...argv]
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    return { command: 'help', helpFor: args[0] }
  }

  const options = {
    command: undefined,
    apiUrl: undefined,
    cwd: undefined,
    notebook: undefined,
    cell: undefined,
    timeoutSeconds: defaultTimeoutSeconds,
    codeArgs: []
  }

  while (args[0] === '--api-url' || args[0] === '--cwd') {
    const flag = args.shift()
    if (flag === '--api-url') options.apiUrl = requireValue(args, flag)
    else if (flag === '--cwd') options.cwd = requireValue(args, flag)
  }

  options.command = args.shift()

  while (args.length > 0) {
    const arg = args.shift()
    if (arg === '--api-url') options.apiUrl = requireValue(args, arg)
    else if (arg === '--cwd') options.cwd = requireValue(args, arg)
    else if (arg === '--notebook') options.notebook = requireValue(args, arg)
    else if (arg === '--cell') options.cell = requireValue(args, arg)
    else if (arg === '--timeout') {
      const raw = requireValue(args, arg)
      const parsed = Number(raw)
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('--timeout must be a positive number of seconds.')
      options.timeoutSeconds = parsed
    } else if (arg?.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`)
    } else if (arg !== undefined) {
      options.codeArgs.push(arg, ...args)
      break
    }
  }

  return options
}

function requireValue(args, flag) {
  const value = args.shift()
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`)
  return value
}

function stripAnsi(value) {
  return String(value).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
}

function sourceToText(source) {
  return Array.isArray(source) ? source.join('') : String(source ?? '')
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function patchCellOutputs(notebook, cellId, outputs, executionCount) {
  if (!isObject(notebook) || !Array.isArray(notebook.cells)) {
    throw new Error('Notebook JSON does not contain a cells array.')
  }

  const cell = notebook.cells.find((candidate) => isObject(candidate) && candidate.id === cellId)
  if (!cell) throw new Error(`Cell id not found: ${cellId}`)
  if (cell.cell_type !== 'code') throw new Error(`Cell ${cellId} is not a code cell.`)

  cell.outputs = outputs
  cell.execution_count = executionCount
  return notebook
}

export function renderOutputText(outputs) {
  let stdout = ''
  let stderr = ''
  for (const output of outputs) {
    if (!isObject(output)) continue
    if (output.output_type === 'stream') {
      const text = sourceToText(output.text)
      if (output.name === 'stderr') stderr += text
      else stdout += text
      continue
    }
    if (output.output_type === 'execute_result' || output.output_type === 'display_data') {
      const data = isObject(output.data) ? output.data : {}
      if (typeof data['text/plain'] === 'string' || Array.isArray(data['text/plain'])) {
        stdout += sourceToText(data['text/plain'])
        if (!stdout.endsWith('\n')) stdout += '\n'
      }
      for (const [mime, value] of Object.entries(data)) {
        if (mime.startsWith('image/') && typeof value === 'string') {
          stdout += `[${mime} output: ${value.length} bytes base64]\n`
        }
      }
      continue
    }
    if (output.output_type === 'error') {
      stderr += `${output.ename ?? 'Error'}: ${output.evalue ?? ''}\n`
      if (Array.isArray(output.traceback)) stderr += `${output.traceback.map(stripAnsi).join('\n')}\n`
    }
  }
  return { stdout, stderr }
}

function printOutputs(outputs) {
  const rendered = renderOutputText(outputs)
  if (rendered.stdout) process.stdout.write(rendered.stdout)
  if (rendered.stderr) process.stderr.write(rendered.stderr)
}

function normalizeApiUrl(value) {
  if (!value) throw new Error('Missing API URL. Pass --api-url or set OPEN_SCIENCE_API_URL.')
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('API URL must be http or https.')
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url
}

function resolveCwd(value) {
  return path.resolve(value ?? process.cwd())
}

function toPosixRelative(filePath, cwd) {
  const absolute = path.resolve(cwd, filePath)
  const relative = path.relative(cwd, absolute)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('--notebook must reference a file inside cwd.')
  }
  return relative.split(path.sep).join('/')
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options)
  const text = await response.text()
  let body = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      throw new Error(`HTTP ${response.status}: ${text}`)
    }
  }
  if (!response.ok) {
    const error = body?.error
    const message = error?.message ?? `HTTP ${response.status}`
    const wrapped = new Error(message)
    wrapped.status = response.status
    wrapped.code = error?.code
    wrapped.details = error?.details
    throw wrapped
  }
  return body
}

function workspaceUrl(apiUrl, cwd) {
  const url = new URL('api/jupyter/workspace', apiUrl)
  url.searchParams.set('cwd', cwd)
  return url
}

async function workspaceStatus(apiUrl, cwd) {
  return fetchJson(workspaceUrl(apiUrl, cwd))
}

async function ensureWorkspace(apiUrl, cwd) {
  try {
    return await fetchJson(new URL('api/jupyter/workspace', apiUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd })
    })
  } catch (error) {
    if (error?.code === 'jupyter_env_missing') {
      const python = error.details?.python
      const missing = []
      if (!python?.hasJupyterServer) missing.push('jupyter_server')
      if (!python?.hasIpykernel) missing.push('ipykernel')
      throw new CliError(
        `Jupyter environment is missing for ${python?.pythonPath ?? 'the selected interpreter'}: ${missing.join(', ')}.`,
        2
      )
    }
    throw error
  }
}

async function findOrCreateSession(connection, notebookPath) {
  const headers = { Authorization: `token ${connection.token}` }
  const sessions = await fetchJson(new URL('api/sessions', connection.baseUrl), { headers })
  const existing = Array.isArray(sessions)
    ? sessions.find((session) => session?.path === notebookPath && session?.type === 'notebook')
    : null
  if (existing?.kernel?.id) return existing

  return fetchJson(new URL('api/sessions', connection.baseUrl), {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: notebookPath,
      name: path.posix.basename(notebookPath),
      type: 'notebook',
      kernel: { name: 'python3' }
    })
  })
}

function makeMessage(sessionId, msgType, content) {
  return {
    header: {
      msg_id: cryptoRandomUUID(),
      username: 'open-science-nbcli',
      session: sessionId,
      date: new Date().toISOString(),
      msg_type: msgType,
      version: '5.3'
    },
    parent_header: {},
    metadata: {},
    content,
    channel: 'shell'
  }
}

function cryptoRandomUUID() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

async function executeCode(connection, kernelId, code, timeoutMs) {
  const sessionId = cryptoRandomUUID()
  const url = new URL(`api/kernels/${kernelId}/channels`, connection.wsUrl)
  url.searchParams.set('session_id', sessionId)
  url.searchParams.set('token', connection.token)
  const ws = new WebSocket(url)
  const msg = makeMessage(sessionId, 'execute_request', {
    code,
    silent: false,
    store_history: true,
    user_expressions: {},
    allow_stdin: false,
    stop_on_error: false
  })
  const msgId = msg.header.msg_id
  const outputs = []
  let executionCount = null
  let replyStatus = null
  let gotReply = false
  let gotIdle = false

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      try {
        ws.close()
      } catch {}
      resolve({ timedOut: true, outputs, executionCount, status: replyStatus ?? 'unknown' })
    }, timeoutMs)

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify(msg))
    })
    ws.addEventListener('error', () => {
      clearTimeout(timeout)
      reject(new Error('Failed to open Jupyter kernel WebSocket.'))
    })
    ws.addEventListener('message', (event) => {
      let message
      try {
        message = JSON.parse(messageEventText(event.data))
      } catch {
        return
      }
      if (message?.parent_header?.msg_id !== msgId) return

      if (message.channel === 'shell' && message.header?.msg_type === 'execute_reply') {
        gotReply = true
        replyStatus = message.content?.status ?? null
        if (typeof message.content?.execution_count === 'number') executionCount = message.content.execution_count
      }

      if (message.channel === 'iopub') {
        const type = message.header?.msg_type
        if (type === 'status' && message.content?.execution_state === 'idle') gotIdle = true
        else if (type === 'execute_input' && typeof message.content?.execution_count === 'number') {
          executionCount = message.content.execution_count
        } else if (type === 'stream') {
          outputs.push({ output_type: 'stream', name: message.content?.name ?? 'stdout', text: message.content?.text ?? '' })
        } else if (type === 'execute_result') {
          outputs.push({
            output_type: 'execute_result',
            data: message.content?.data ?? {},
            metadata: message.content?.metadata ?? {},
            execution_count: message.content?.execution_count ?? executionCount
          })
        } else if (type === 'display_data') {
          outputs.push({
            output_type: 'display_data',
            data: message.content?.data ?? {},
            metadata: message.content?.metadata ?? {}
          })
        } else if (type === 'error') {
          outputs.push({
            output_type: 'error',
            ename: message.content?.ename ?? '',
            evalue: message.content?.evalue ?? '',
            traceback: Array.isArray(message.content?.traceback)
              ? message.content.traceback.map(stripAnsi)
              : []
          })
        }
      }

      if (gotReply && gotIdle) {
        clearTimeout(timeout)
        try {
          ws.close()
        } catch {}
        resolve({ timedOut: false, outputs, executionCount, status: replyStatus ?? 'ok' })
      }
    })
  })
}

function messageEventText(data) {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8')
  return String(data)
}

async function loadNotebook(filePath) {
  const raw = await fs.readFile(filePath, 'utf8')
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new CliError(`Notebook could not be parsed: ${error instanceof Error ? error.message : String(error)}`, 2)
  }
}

function findCodeCell(notebook, cellId) {
  if (!isObject(notebook) || !Array.isArray(notebook.cells)) {
    throw new CliError('Notebook JSON does not contain a cells array.', 2)
  }
  const cell = notebook.cells.find((candidate) => isObject(candidate) && candidate.id === cellId)
  if (!cell) throw new CliError(`Cell id not found: ${cellId}`, 2)
  if (cell.cell_type !== 'code') throw new CliError(`Cell ${cellId} is not a code cell.`, 2)
  return cell
}

async function writeNotebook(filePath, notebook) {
  await fs.writeFile(filePath, `${JSON.stringify(notebook, null, 2)}\n`)
}

async function runStatus(options) {
  const apiUrl = normalizeApiUrl(options.apiUrl ?? process.env.OPEN_SCIENCE_API_URL)
  const cwd = resolveCwd(options.cwd)
  const status = await workspaceStatus(apiUrl, cwd)
  const python = status.python
  console.log(`cwd: ${cwd}`)
  console.log(`python: ${python.pythonPath ?? 'not found'}`)
  console.log(`jupyter_server: ${python.hasJupyterServer ? 'present' : 'missing'}`)
  console.log(`ipykernel: ${python.hasIpykernel ? 'present' : 'missing'}`)
  console.log(`server: ${status.server?.running ? 'running' : 'stopped'}`)
}

async function runExec(options, mode) {
  if (!options.notebook) throw new CliError(`--notebook is required.\n${usage(mode)}`, 2)
  const apiUrl = normalizeApiUrl(options.apiUrl ?? process.env.OPEN_SCIENCE_API_URL)
  const cwd = resolveCwd(options.cwd)
  const notebookPath = toPosixRelative(options.notebook, cwd)
  const notebookFile = path.join(cwd, notebookPath)
  let notebook = null
  let code

  if (mode === 'exec-cell') {
    if (!options.cell) throw new CliError(`--cell is required.\n${usage(mode)}`, 2)
    notebook = await loadNotebook(notebookFile)
    code = sourceToText(findCodeCell(notebook, options.cell).source)
  } else {
    if (options.codeArgs.length === 0) throw new CliError(`Code is required.\n${usage(mode)}`, 2)
    code = options.codeArgs.length === 1 && options.codeArgs[0] === '-' ? await readStdin() : options.codeArgs.join(' ')
  }

  const connection = await ensureWorkspace(apiUrl, cwd)
  const session = await findOrCreateSession(connection, notebookPath)
  const kernelId = session?.kernel?.id
  if (!kernelId) throw new Error('Jupyter session response did not include a kernel id.')
  const result = await executeCode(connection, kernelId, code, options.timeoutSeconds * 1000)

  printOutputs(result.outputs)
  if (result.timedOut) throw new CliError(`Execution timed out after ${options.timeoutSeconds} seconds.`, 3)

  if (mode === 'exec-cell') {
    patchCellOutputs(notebook, options.cell, result.outputs, result.executionCount)
    await writeNotebook(notebookFile, notebook)
  }

  if (result.status === 'error') process.exit(1)
}

class CliError extends Error {
  constructor(message, exitCode = 2) {
    super(message)
    this.exitCode = exitCode
  }
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    die(error instanceof Error ? error.message : String(error), 2)
  }

  if (options.command === 'help') {
    console.log(usage(options.helpFor))
    return
  }
  if (options.command === 'status') return runStatus(options)
  if (options.command === 'exec-code') return runExec(options, 'exec-code')
  if (options.command === 'exec-cell') return runExec(options, 'exec-cell')
  throw new CliError(`Unknown command: ${options.command}\n${usage()}`, 2)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    const exitCode = error?.exitCode ?? 2
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(exitCode)
  })
}
