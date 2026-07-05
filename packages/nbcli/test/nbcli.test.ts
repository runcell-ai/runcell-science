import assert from 'node:assert/strict'
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  buildMediaPath,
  budgetOutputsForReport,
  parseArgs,
  patchCellOutputs,
  renderCellRead,
  renderCellsOverview,
  renderOutputText,
  summarizeOutputs,
  truncateMiddle
} from '../nbcli.mjs'

test('patchCellOutputs only replaces outputs and execution_count on the target cell', () => {
  const notebook = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { custom: { keep: true } },
    cells: [
      {
        id: 'markdown-1',
        cell_type: 'markdown',
        source: ['# Title\n'],
        metadata: { untouched: true }
      },
      {
        id: 'code-1',
        cell_type: 'code',
        source: ['x = 1\n'],
        metadata: { tags: ['keep'], nested: { value: 1 } },
        execution_count: 7,
        outputs: [{ output_type: 'stream', name: 'stdout', text: 'old\n' }],
        custom_field: { duplicateShape: [{ a: 1 }, { a: 1 }] }
      },
      {
        id: 'code-2',
        cell_type: 'code',
        source: ['y = 2\n'],
        metadata: { untouched: true },
        execution_count: null,
        outputs: [],
        custom_field: { duplicateShape: [{ b: 2 }, { b: 2 }] }
      }
    ],
    custom_top_level: { keep: ['a', 'b'] }
  }
  const before = structuredClone(notebook)
  const outputs = [{ output_type: 'stream', name: 'stdout', text: 'new\n' }]

  patchCellOutputs(notebook, 'code-1', outputs, 8)

  assert.deepEqual(notebook.cells[0], before.cells[0])
  assert.deepEqual(notebook.cells[2], before.cells[2])
  assert.deepEqual(notebook.metadata, before.metadata)
  assert.deepEqual(notebook.custom_top_level, before.custom_top_level)
  assert.deepEqual(notebook.cells[1].metadata, before.cells[1].metadata)
  assert.deepEqual(notebook.cells[1].source, before.cells[1].source)
  assert.deepEqual(notebook.cells[1].custom_field, before.cells[1].custom_field)
  assert.deepEqual(notebook.cells[1].outputs, outputs)
  assert.equal(notebook.cells[1].execution_count, 8)
})

test('patchCellOutputs rejects missing and non-code cells', () => {
  const notebook = {
    cells: [{ id: 'markdown-1', cell_type: 'markdown', source: ['text'] }]
  }

  assert.throws(() => patchCellOutputs(notebook, 'missing', [], null), /Cell id not found/)
  assert.throws(() => patchCellOutputs(notebook, 'markdown-1', [], null), /not a code cell/)
})

test('renderOutputText renders text, image placeholders, and stripped tracebacks', () => {
  const rendered = renderOutputText([
    { output_type: 'stream', name: 'stdout', text: 'hello\n' },
    { output_type: 'stream', name: 'stderr', text: 'warn\n' },
    { output_type: 'execute_result', data: { 'text/plain': '42' }, metadata: {}, execution_count: 1 },
    { output_type: 'display_data', data: { 'image/png': 'abcd' }, metadata: {} },
    {
      output_type: 'error',
      ename: 'ValueError',
      evalue: 'bad',
      traceback: ['\u001b[31mTraceback line\u001b[0m']
    }
  ])

  assert.equal(rendered.stdout, 'hello\n42\n[image/png output: 4 bytes base64]\n')
  assert.equal(rendered.stderr, 'warn\nValueError: bad\nTraceback line\n')
})

test('parseArgs parses exec-code and status flags', () => {
  assert.deepEqual(parseArgs(['status', '--api-url', 'http://127.0.0.1:1', '--cwd', '/tmp']), {
    command: 'status',
    apiUrl: 'http://127.0.0.1:1',
    cwd: '/tmp',
    notebook: undefined,
    cell: undefined,
    maxOutputChars: 8000,
    mediaDir: undefined,
    timeoutSeconds: 300,
    codeArgs: []
  })

  assert.deepEqual(parseArgs(['exec-code', '--notebook', 't.ipynb', '--timeout', '5', 'print(1)']), {
    command: 'exec-code',
    apiUrl: undefined,
    cwd: undefined,
    notebook: 't.ipynb',
    cell: undefined,
    maxOutputChars: 8000,
    mediaDir: undefined,
    timeoutSeconds: 5,
    codeArgs: ['print(1)']
  })
})

test('truncateMiddle passes through under budget and keeps head and tail over budget', () => {
  assert.equal(truncateMiddle('short', 10), 'short')

  const rendered = truncateMiddle('0123456789abcdefghij', 10)
  assert.equal(rendered, '012345\n… [truncated: showing 10 of 20 chars] …\nghij')
})

test('budgetOutputsForReport truncates long text output fields', () => {
  const report = budgetOutputsForReport([
    { output_type: 'stream', name: 'stdout', text: 'A'.repeat(5_000) },
    { output_type: 'execute_result', data: { 'text/plain': 'B'.repeat(5_000) }, metadata: {}, execution_count: 1 },
    { output_type: 'error', ename: 'ValueError', evalue: 'bad', traceback: ['C'.repeat(5_000)] }
  ])

  assert.equal(report.truncated, true)
  assert.match(report.outputs[0]?.text as string, /truncated: showing 4000 of 5000 chars/)
  assert.match((report.outputs[1]?.data as any)['text/plain'], /truncated: showing 4000 of 5000 chars/)
  assert.match((report.outputs[2]?.traceback as string[]).join('\n'), /truncated: showing 4000 of 5000 chars/)
})

test('budgetOutputsForReport keeps at most three images and replaces extras', () => {
  const outputs = Array.from({ length: 5 }, (_, index) => ({
    output_type: 'display_data',
    data: { 'image/png': Buffer.from(`image-${index}`).toString('base64') },
    metadata: {}
  }))

  const report = budgetOutputsForReport(outputs)

  assert.equal(report.truncated, true)
  assert.equal(report.outputs.filter((output) => (output.data as any)?.['image/png']).length, 3)
  assert.equal(report.outputs.filter((output) => output.output_type === 'stream' && /\[image dropped:/.test(String(output.text))).length, 2)
})

test('budgetOutputsForReport trims to twenty outputs with an omission marker', () => {
  const outputs = Array.from({ length: 25 }, (_, index) => ({
    output_type: 'stream',
    name: 'stdout',
    text: `line ${index}\n`
  }))

  const report = budgetOutputsForReport(outputs)

  assert.equal(report.truncated, true)
  assert.equal(report.outputs.length, 20)
  assert.match(String(report.outputs.at(-1)?.text), /\[6 more outputs omitted\]/)
})

test('budgetOutputsForReport truncates oversized json instead of dropping the output', () => {
  const report = budgetOutputsForReport([
    { output_type: 'stream', name: 'stdout', text: 'small\n' },
    {
      output_type: 'display_data',
      data: { 'application/json': { value: 'X'.repeat(6 * 1024 * 1024) } },
      metadata: {}
    }
  ])

  assert.equal(report.truncated, true)
  assert.equal(report.outputs.length, 2)
  assert.equal(Buffer.byteLength(JSON.stringify({ outputs: report.outputs }), 'utf8') < 100_000, true)
})

test('budgetOutputsForReport drops trailing outputs when images alone exceed the payload target', () => {
  // Images bypass the text budget; three near-cap images (~2M chars each)
  // exceed the 5.7MB payload target, forcing the total-size fallback.
  const image = 'A'.repeat(1_999_000)
  const report = budgetOutputsForReport([
    { output_type: 'stream', name: 'stdout', text: 'small\n' },
    { output_type: 'display_data', data: { 'image/png': image }, metadata: {} },
    { output_type: 'display_data', data: { 'image/png': image }, metadata: {} },
    { output_type: 'display_data', data: { 'image/png': image }, metadata: {} }
  ])

  assert.equal(report.truncated, true)
  assert.ok(report.outputs.length < 4)
  assert.equal(Buffer.byteLength(JSON.stringify({ outputs: report.outputs }), 'utf8') < 5_700_000, true)
})

test('summarizeOutputs and cells overview include mixed output kinds', () => {
  const outputs = [
    { output_type: 'stream', name: 'stdout', text: 'hello\n' },
    { output_type: 'display_data', data: { 'text/plain': 'plot', 'image/png': 'abc' }, metadata: {} },
    { output_type: 'error', ename: 'ValueError', evalue: 'bad', traceback: [] }
  ]
  assert.equal(summarizeOutputs(outputs), 'stream, image/png, error')

  const overview = renderCellsOverview({
    cells: [
      {
        id: 'mixed',
        cell_type: 'code',
        execution_count: 3,
        source: ['print("x")\n'],
        outputs
      }
    ]
  })
  assert.equal(overview, 'mixed  code  [3]  print("x")  outputs: stream, image/png, error\n')
})

test('media filename builder sanitizes notebook and cell id parts', () => {
  const mediaPath = buildMediaPath({
    notebookPath: 'dir/my notebook.ipynb',
    cellId: 'cell/with spaces/☃',
    outputIndex: 2,
    mime: 'image/png',
    mediaDir: '/tmp/media'
  })

  assert.equal(mediaPath, path.join('/tmp/media', 'my_notebook-cell_with_spaces__-2.png'))
})

test('renderCellRead prefers text/plain while still saving image outputs', async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), 'open-science-nbcli-unit-'))
  try {
    const rendered = await renderCellRead(
      {
        id: 'cell-1',
        cell_type: 'code',
        execution_count: 1,
        source: ['display(x)\n'],
        outputs: [
          {
            output_type: 'display_data',
            data: {
              'text/plain': 'plain repr',
              'text/html': '<b>html repr</b>',
              'image/png': 'iVBORw0KGgo='
            },
            metadata: {}
          }
        ]
      },
      {
        maxOutputChars: 8000,
        mediaDir,
        notebookPath: 't.ipynb',
        cellId: 'cell-1'
      }
    )

    assert.match(rendered, /plain repr/)
    assert.match(rendered, /\[image\/png output: \d+ bytes\] saved to:/)
    assert.doesNotMatch(rendered, /html repr/)
  } finally {
    await rm(mediaDir, { recursive: true, force: true })
  }
})

test('renderCellRead caps the whole cell at 4x the per-output budget', async () => {
  const outputs = Array.from({ length: 10 }, (_, index) => ({
    output_type: 'stream',
    name: 'stdout',
    text: `chunk-${index} ${'x'.repeat(7900)}\n`
  }))
  const rendered = await renderCellRead(
    { id: 'big', cell_type: 'code', source: 'noisy()', execution_count: 1, outputs },
    { maxOutputChars: 8000, mediaDir: os.tmpdir(), notebookPath: 't.ipynb', cellId: 'big' }
  )
  assert.ok(rendered.length < 8000 * 6, `rendered ${rendered.length} chars`)
  assert.match(rendered, /more outputs? omitted \(stream/)
  assert.match(rendered, /raise --max-output-chars/)
})

test('media extraction never writes through a pre-existing symlink', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nbcli-symlink-'))
  try {
    const mediaDir = path.join(root, 'media')
    const victim = path.join(root, 'victim.txt')
    await writeFile(victim, 'do not touch')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(mediaDir, { recursive: true })
    const target = buildMediaPath({ notebookPath: 't.ipynb', cellId: 'c1', outputIndex: 1, mime: 'image/png', mediaDir })
    await symlink(victim, target)

    const rendered = await renderCellRead(
      {
        id: 'c1',
        cell_type: 'code',
        source: 'plot()',
        execution_count: 1,
        outputs: [{ output_type: 'display_data', data: { 'image/png': Buffer.from('png-bytes').toString('base64') }, metadata: {} }]
      },
      { maxOutputChars: 8000, mediaDir, notebookPath: 't.ipynb', cellId: 'c1' }
    )

    assert.match(rendered, /saved to:/)
    assert.equal(await readFile(victim, 'utf8'), 'do not touch')
    const stat = await lstat(target)
    assert.equal(stat.isSymbolicLink(), false)
    assert.equal(await readFile(target, 'utf8'), 'png-bytes')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('budgetOutputsForReport budgets html and other non-image mimes', () => {
  const bigHtml = `<table>${'<tr><td>x</td></tr>'.repeat(5000)}</table>`
  const smallHtml = '<b>ok</b>'
  const bigJson = 'y'.repeat(10_000)
  const { outputs, truncated } = budgetOutputsForReport([
    {
      output_type: 'execute_result',
      execution_count: 1,
      metadata: {},
      data: { 'text/plain': 'plain table repr', 'text/html': bigHtml }
    },
    {
      output_type: 'display_data',
      metadata: {},
      data: { 'text/html': smallHtml, 'text/latex': bigJson }
    }
  ])

  assert.equal(truncated, true)
  const first = outputs[0] as { data: Record<string, unknown> }
  assert.equal(first.data['text/html'], undefined)
  assert.equal(first.data['text/plain'], 'plain table repr')
  const second = outputs[1] as { data: Record<string, unknown> }
  assert.equal(second.data['text/html'], smallHtml)
  assert.match(String(second.data['text/latex']), /truncated: showing/)
})

test('budgetOutputsForReport budgets object-valued JSON mimes', () => {
  const bigObject = { rows: Array.from({ length: 2000 }, (_, index) => ({ index, label: `row-${index}` })) }
  const { outputs, truncated } = budgetOutputsForReport([
    {
      output_type: 'execute_result',
      execution_count: 1,
      metadata: {},
      data: { 'text/plain': 'plain fallback', 'application/json': bigObject }
    },
    {
      output_type: 'display_data',
      metadata: {},
      data: { 'application/vnd.plotly.v1+json': bigObject }
    }
  ])

  assert.equal(truncated, true)
  const withFallback = outputs[0] as { data: Record<string, unknown> }
  assert.equal(withFallback.data['application/json'], undefined)
  assert.equal(withFallback.data['text/plain'], 'plain fallback')
  const withoutFallback = outputs[1] as { data: Record<string, unknown> }
  const replaced = withoutFallback.data['application/vnd.plotly.v1+json']
  assert.equal(typeof replaced, 'string')
  assert.ok((replaced as string).length < 10_000)
  assert.match(replaced as string, /truncated: showing/)
})
