import assert from 'node:assert/strict'
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  buildMediaPath,
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
