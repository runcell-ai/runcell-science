#!/usr/bin/env node
// @ts-check

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import process from 'node:process'

const defaultTimeoutSeconds = 300
const reportTextBudgetChars = 4_000
// Truncated HTML renders as a broken table; beyond this we drop the html key
// and let the text/plain fallback carry the output.
const reportHtmlBudgetChars = 50_000
const reportImageBudgetChars = 2_000_000
const reportMaxImageOutputs = 3
const reportMaxOutputs = 20
const reportPayloadTargetBytes = 5_700_000

function usage(command = '') {
  const common = '[--api-url <url>] [--cwd <path>]'
  if (command === 'status') return `Usage: nbcli status ${common}`
  if (command === 'exec-code') {
    return `Usage: nbcli exec-code ${common} --notebook <path> [--timeout <sec>] <code...>\n       nbcli exec-code ${common} --notebook <path> -`
  }
  if (command === 'exec-cell') {
    return `Usage: nbcli exec-cell ${common} --notebook <path> --cell <cell-id> [--timeout <sec>]`
  }
  if (command === 'cells') return 'Usage: nbcli cells --notebook <path> [--cwd <path>]'
  if (command === 'read-cell') {
    return 'Usage: nbcli read-cell --notebook <path> --cell <cell-id> [--cwd <path>] [--max-output-chars <n>] [--media-dir <dir>]'
  }
  return `Usage: nbcli <command> ${common}\n\nCommands:\n  status\n  cells --notebook <path> [--cwd <path>]\n  read-cell --notebook <path> --cell <cell-id> [--max-output-chars <n>] [--media-dir <dir>]\n  exec-code --notebook <path> [--timeout <sec>] <code...>\n  exec-cell --notebook <path> --cell <cell-id> [--timeout <sec>]`
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
    maxOutputChars: 8000,
    mediaDir: undefined,
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
    else if (arg === '--max-output-chars' && options.command === 'read-cell') {
      const raw = requireValue(args, arg)
      const parsed = Number(raw)
      if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('--max-output-chars must be a positive integer.')
      options.maxOutputChars = parsed
    } else if (arg === '--media-dir' && options.command === 'read-cell') {
      options.mediaDir = requireValue(args, arg)
    }
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

function joinText(value) {
  return Array.isArray(value) ? value.join('') : String(value ?? '')
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

export function truncateMiddle(value, maxChars = 8000) {
  const text = String(value ?? '')
  if (text.length <= maxChars) return text
  const headChars = Math.ceil(maxChars * 0.6)
  const tailChars = Math.max(0, maxChars - headChars)
  const shown = headChars + tailChars
  return `${text.slice(0, headChars)}\n… [truncated: showing ${shown} of ${text.length} chars] …\n${tailChars > 0 ? text.slice(-tailChars) : ''}`
}

function syntheticStream(text) {
  return { output_type: 'stream', name: 'stdout', text: `${text}\n` }
}

function cloneOutput(output) {
  if (typeof structuredClone === 'function') {
    return structuredClone(output)
  }
  return JSON.parse(JSON.stringify(output))
}

function truncateTextField(value) {
  const text = joinText(value)
  const next = truncateMiddle(text, reportTextBudgetChars)
  return { value: next, truncated: next !== text }
}

function imageByteLength(base64) {
  try {
    return Buffer.byteLength(base64, 'base64')
  } catch {
    return base64.length
  }
}

function budgetOneOutputForReport(rawOutput, imageState) {
  const output = cloneOutput(rawOutput)
  let truncated = false

  if (output?.output_type === 'stream') {
    const next = truncateTextField(output.text)
    output.text = next.value
    return { output, truncated: truncated || next.truncated }
  }

  if (output?.output_type === 'error') {
    const traceback = Array.isArray(output.traceback)
      ? output.traceback.map((line) => String(line)).join('\n')
      : joinText(output.traceback)
    const next = truncateTextField(traceback)
    output.traceback = next.value ? next.value.split('\n') : []
    return { output, truncated: truncated || next.truncated }
  }

  if ((output?.output_type === 'display_data' || output?.output_type === 'execute_result') && isObject(output.data)) {
    if (output.data['text/plain'] !== undefined) {
      const next = truncateTextField(output.data['text/plain'])
      output.data['text/plain'] = next.value
      truncated = truncated || next.truncated
    }

    // Non-image renderable mimes must be budgeted too: a pandas/Styler table
    // can carry megabytes of text/html — and application/json or plotly
    // bundles store OBJECTS, which joinText would miscount, so non-string
    // values are measured via JSON.stringify.
    for (const [mime, value] of Object.entries(output.data)) {
      if (mime === 'text/plain' || mime.startsWith('image/')) continue
      // nbformat text arrays are arrays OF STRINGS; json/plotly mimes may
      // legally be arrays of objects and must be measured as JSON.
      const stringish =
        typeof value === 'string' || (Array.isArray(value) && value.every((part) => typeof part === 'string'))
      const text = stringish ? joinText(value) : JSON.stringify(value) ?? ''
      if (mime === 'text/html') {
        // All-or-nothing: truncated HTML renders as a broken partial table
        // and the renderer prefers it over the intact text/plain fallback.
        if (text.length > reportHtmlBudgetChars) {
          delete output.data[mime]
          truncated = true
        }
        continue
      }
      if (text.length > reportTextBudgetChars) {
        if (!stringish && output.data['text/plain'] !== undefined) {
          // Rich JSON with a plain fallback: drop it rather than mangle it.
          delete output.data[mime]
          truncated = true
          continue
        }
        const next = truncateTextField(text)
        output.data[mime] = next.value
        truncated = true
      }
    }

    for (const [mime, value] of Object.entries(output.data)) {
      if (!mime.startsWith('image/') || typeof value !== 'string' || value.length === 0) {
        continue
      }
      imageState.count += 1
      if (imageState.count > reportMaxImageOutputs) {
        return {
          output: syntheticStream('[image dropped: inline image limit exceeded]'),
          truncated: true
        }
      }
      if (value.length > reportImageBudgetChars) {
        return {
          output: syntheticStream(`[image dropped: ${imageByteLength(value)} bytes exceeds inline budget]`),
          truncated: true
        }
      }
    }
  }

  return { output, truncated }
}

export function budgetOutputsForReport(outputs) {
  const imageState = { count: 0 }
  let truncated = false
  let budgeted = outputs.map((output) => {
    const next = budgetOneOutputForReport(output, imageState)
    truncated = truncated || next.truncated
    return next.output
  })

  if (budgeted.length > reportMaxOutputs) {
    const omitted = budgeted.length - (reportMaxOutputs - 1)
    budgeted = [
      ...budgeted.slice(0, reportMaxOutputs - 1),
      syntheticStream(`[${omitted} more output${omitted === 1 ? '' : 's'} omitted]`)
    ]
    truncated = true
  }

  while (budgeted.length > 0 && Buffer.byteLength(JSON.stringify(budgeted), 'utf8') >= reportPayloadTargetBytes) {
    budgeted = budgeted.slice(0, -1)
    truncated = true
  }

  return { outputs: budgeted, truncated }
}

function truncateLine(value, maxChars) {
  const text = String(value ?? '')
  if (text.length <= maxChars) return text
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`
}

function validateNotebookCells(notebook) {
  if (!isObject(notebook) || !Array.isArray(notebook.cells)) {
    throw new CliError('Notebook JSON does not contain a cells array.', 2)
  }
  return notebook.cells.filter(isObject)
}

function notebookFileForOptions(options) {
  if (!options.notebook) throw new CliError(`--notebook is required.\n${usage(options.command)}`, 2)
  const cwd = resolveCwd(options.cwd)
  const notebookPath = toPosixRelative(options.notebook, cwd)
  return { cwd, notebookPath, notebookFile: path.join(cwd, notebookPath) }
}

function bestMimeForSummary(data) {
  if (!isObject(data)) return null
  const keys = Object.keys(data)
  const image = keys.find((key) => key.startsWith('image/'))
  if (image) return image
  if (keys.includes('text/html')) return 'text/html'
  if (keys.includes('text/plain')) return 'text/plain'
  return keys[0] ?? null
}

export function summarizeOutputs(outputs) {
  if (!Array.isArray(outputs) || outputs.length === 0) return '-'
  const kinds = []
  for (const output of outputs) {
    if (!isObject(output)) continue
    if (output.output_type === 'stream') kinds.push('stream')
    else if (output.output_type === 'error') kinds.push('error')
    else if (output.output_type === 'execute_result' || output.output_type === 'display_data') {
      const mime = bestMimeForSummary(output.data)
      if (mime) kinds.push(mime)
    } else if (typeof output.output_type === 'string') {
      kinds.push(output.output_type)
    }
  }
  return kinds.length > 0 ? kinds.join(', ') : '-'
}

export function renderCellsOverview(notebook) {
  const cells = validateNotebookCells(notebook)
  if (cells.length === 0) return '(no cells)\n'
  return cells.map((cell) => {
    const id = String(cell.id ?? '(no-id)')
    const type = String(cell.cell_type ?? 'unknown')
    const executionCount = typeof cell.execution_count === 'number' ? String(cell.execution_count) : ' '
    const firstLine = sourceToText(cell.source).split(/\r?\n/, 1)[0] ?? ''
    const outputs = summarizeOutputs(Array.isArray(cell.outputs) ? cell.outputs : [])
    return `${id}  ${type}  [${executionCount}]  ${truncateLine(firstLine, 60)}  outputs: ${outputs}`
  }).join('\n') + '\n'
}

function availableCellIds(cells) {
  return cells.slice(0, 20).map((cell) => String(cell.id ?? '(no-id)')).join(', ')
}

function findAnyCell(notebook, cellId) {
  const cells = validateNotebookCells(notebook)
  const cell = cells.find((candidate) => candidate.id === cellId)
  if (!cell) {
    const suffix = cells.length > 0 ? ` Available cell ids: ${availableCellIds(cells)}${cells.length > 20 ? ', ...' : ''}` : ' No cells are available.'
    throw new CliError(`Cell id not found: ${cellId}.${suffix}`, 2)
  }
  return cell
}

export function sanitizeMediaFilenamePart(value) {
  return String(value).replace(/[^A-Za-z0-9._-]/g, '_')
}

export function buildMediaPath({ notebookPath, cellId, outputIndex, mime, mediaDir }) {
  const base = sanitizeMediaFilenamePart(path.basename(notebookPath, path.extname(notebookPath)))
  const safeCellId = sanitizeMediaFilenamePart(cellId)
  const ext = mime === 'image/svg+xml' ? 'svg' : mime.slice('image/'.length)
  return path.join(mediaDir, `${base}-${safeCellId}-${outputIndex}.${ext}`)
}

function textFromJsonMime(value) {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      return value
    }
  }
  return JSON.stringify(value, null, 2)
}

function formatUnknownMime(mime, value) {
  return `[${mime} output: ${joinText(value).length} chars, not rendered]\n`
}

async function writeMediaOutput({ mime, value, notebookPath, cellId, outputIndex, mediaDir }) {
  await fs.mkdir(mediaDir, { recursive: true })
  // The default media dir is a predictable shared temp path; never write
  // through a pre-existing symlink there (rm removes the link itself, wx
  // guarantees we only ever create fresh files).
  const dirStat = await fs.lstat(mediaDir)
  if (!dirStat.isDirectory()) {
    throw new CliError(`Media directory is not a real directory: ${mediaDir}. Pass a different --media-dir.`, 2)
  }
  const filePath = buildMediaPath({ notebookPath, cellId, outputIndex, mime, mediaDir })
  await fs.rm(filePath, { force: true })
  if (mime === 'image/svg+xml') {
    const svg = joinText(value)
    await fs.writeFile(filePath, svg, { encoding: 'utf8', flag: 'wx' })
    return `[image/svg+xml output: vector/text, ${svg.length} chars] saved to: ${filePath}\nOpen this file with your image viewing/reading tool to see the plot, or read it as text.\n`
  }
  const buffer = Buffer.from(joinText(value), 'base64')
  await fs.writeFile(filePath, buffer, { flag: 'wx' })
  return `[${mime} output: ${buffer.length} bytes] saved to: ${filePath}\nOpen this file with your image viewing/reading tool to see the plot.\n`
}

async function renderMimeBundle(output, context) {
  const data = isObject(output.data) ? output.data : {}
  const chunks = []
  const keys = Object.keys(data)

  if (keys.includes('text/plain')) {
    chunks.push(`${truncateMiddle(joinText(data['text/plain']), context.maxOutputChars)}\n`)
  } else if (keys.includes('application/json')) {
    chunks.push(`${truncateMiddle(textFromJsonMime(data['application/json']), context.maxOutputChars)}\n`)
  } else if (keys.includes('text/html')) {
    const html = joinText(data['text/html'])
    chunks.push(`[text/html output, ${html.length} chars — showing truncated raw]\n${truncateMiddle(html, context.maxOutputChars)}\n`)
  }

  for (const mime of ['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml']) {
    if (keys.includes(mime)) chunks.push(await writeMediaOutput({ ...context, mime, value: data[mime] }))
  }

  const rendered = new Set(['text/plain', 'application/json', 'text/html', 'image/png', 'image/jpeg', 'image/gif', 'image/svg+xml'])
  for (const mime of keys) {
    if (!rendered.has(mime)) chunks.push(formatUnknownMime(mime, data[mime]))
  }
  return chunks.join('')
}

export async function renderCellRead(cell, options) {
  const outputs = Array.isArray(cell.outputs) ? cell.outputs : []
  const executionCount = typeof cell.execution_count === 'number' ? cell.execution_count : null
  const chunks = [
    `cell: ${String(cell.id ?? '')}\n`,
    `type: ${String(cell.cell_type ?? 'unknown')}\n`,
    `execution_count: ${executionCount === null ? 'null' : executionCount}\n`,
    '--- source ---\n'
  ]
  const source = sourceToText(cell.source)
  chunks.push(source)
  if (!source.endsWith('\n')) chunks.push('\n')

  if (outputs.length === 0) {
    chunks.push('(no outputs)\n')
    return chunks.join('')
  }

  // The per-output cap alone does not bound the whole command: a cell can
  // hold hundreds of just-under-budget outputs. Cap the cell total too.
  const totalBudget = options.maxOutputChars * 4
  let rendered = 0

  chunks.push(`--- outputs (${outputs.length}) ---\n`)
  for (const [index, output] of outputs.entries()) {
    if (!isObject(output)) continue
    if (rendered >= totalBudget) {
      const remaining = outputs.slice(index).filter(isObject)
      chunks.push(
        `… [${remaining.length} more output${remaining.length === 1 ? '' : 's'} omitted (${summarizeOutputs(remaining)}) — total output exceeds budget; raise --max-output-chars to see more]\n`
      )
      break
    }
    chunks.push(`--- output ${index + 1}: ${output.output_type ?? 'unknown'} ---\n`)
    let piece = ''
    if (output.output_type === 'stream') {
      piece = `${output.name === 'stderr' ? '[stderr]\n' : ''}${truncateMiddle(joinText(output.text), options.maxOutputChars)}\n`
    } else if (output.output_type === 'error') {
      const header = `${output.ename ?? 'Error'}: ${output.evalue ?? ''}`
      const traceback = Array.isArray(output.traceback) ? output.traceback.map(stripAnsi).join('\n') : ''
      piece = `${truncateMiddle(traceback ? `${header}\n${traceback}` : header, options.maxOutputChars)}\n`
    } else if (output.output_type === 'execute_result' || output.output_type === 'display_data') {
      piece = await renderMimeBundle(output, { ...options, outputIndex: index + 1 })
    } else {
      piece = `[${output.output_type ?? 'unknown'} output: not rendered]\n`
    }
    chunks.push(piece)
    rendered += piece.length
  }
  return chunks.join('')
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
      throw new CliError(
        python?.pythonPath
          ? `Python interpreter ${python.pythonPath} is missing ipykernel. Install it (e.g. uv pip install --python ${python.pythonPath} ipykernel) and retry.`
          : 'No Python interpreter was found for this workspace. Create a .venv or install python3.',
        2
      )
    }
    throw error
  }
}

// Best-effort UI signal so the user's notebook panel focuses the file being
// executed. Never blocks or fails an execution.
async function reportNotebookActivity(apiUrl, cwd, notebookPath) {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2_000)
    await fetch(new URL('api/jupyter/workspace/activity', apiUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd, notebook: notebookPath }),
      signal: controller.signal
    })
    clearTimeout(timeout)
  } catch {
    // Ignore: the panel focus signal is optional.
  }
}

async function reportNotebookExecution(apiUrl, payload) {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2_000)
    try {
      await fetch(new URL('api/jupyter/workspace/execution', apiUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      })
    } finally {
      clearTimeout(timeout)
    }
  } catch {
    // Ignore: inline timeline reporting must never fail the notebook command.
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
      // Per-workspace kernelspec registered by the server; runs the project python.
      kernel: { name: 'open-science-python' }
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
  console.log(`ipykernel: ${python.hasIpykernel ? 'present' : 'missing'}`)
  const runtime = status.runtime ?? {}
  console.log(`runtime: ${runtime.ready ? 'ready' : runtime.provisioning ? 'provisioning' : runtime.error ? `error (${runtime.error})` : 'not provisioned yet'}`)
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
  await reportNotebookActivity(apiUrl, cwd, notebookPath)
  const session = await findOrCreateSession(connection, notebookPath)
  const kernelId = session?.kernel?.id
  if (!kernelId) throw new Error('Jupyter session response did not include a kernel id.')
  const startedAt = Date.now()
  const result = await executeCode(connection, kernelId, code, options.timeoutSeconds * 1000)
  const durationMs = Date.now() - startedAt
  const reportOutputs = budgetOutputsForReport(result.outputs)
  await reportNotebookExecution(apiUrl, {
    cwd,
    notebook: notebookPath,
    mode,
    cellId: mode === 'exec-cell' ? options.cell : null,
    status: result.timedOut ? 'timeout' : result.status === 'error' ? 'error' : 'ok',
    executionCount: result.executionCount,
    durationMs,
    outputs: reportOutputs.outputs,
    truncated: reportOutputs.truncated
  })

  printOutputs(result.outputs)
  if (result.timedOut) throw new CliError(`Execution timed out after ${options.timeoutSeconds} seconds.`, 3)

  if (mode === 'exec-cell') {
    patchCellOutputs(notebook, options.cell, result.outputs, result.executionCount)
    await writeNotebook(notebookFile, notebook)
  }

  if (result.status === 'error') process.exit(1)
}

async function runCells(options) {
  const { notebookFile } = notebookFileForOptions(options)
  const notebook = await loadNotebook(notebookFile)
  process.stdout.write(renderCellsOverview(notebook))
}

async function runReadCell(options) {
  if (!options.cell) throw new CliError(`--cell is required.\n${usage('read-cell')}`, 2)
  const { cwd, notebookPath, notebookFile } = notebookFileForOptions(options)
  const notebook = await loadNotebook(notebookFile)
  const cell = findAnyCell(notebook, options.cell)
  const mediaDir = path.resolve(options.mediaDir ? path.resolve(cwd, options.mediaDir) : path.join(os.tmpdir(), 'open-science-nb-media'))
  process.stdout.write(await renderCellRead(cell, {
    maxOutputChars: options.maxOutputChars,
    mediaDir,
    notebookPath,
    cellId: options.cell
  }))
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
  if (options.command === 'cells') return runCells(options)
  if (options.command === 'read-cell') return runReadCell(options)
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
