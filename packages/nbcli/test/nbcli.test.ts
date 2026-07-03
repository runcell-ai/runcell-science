import assert from 'node:assert/strict'
import test from 'node:test'

import { parseArgs, patchCellOutputs, renderOutputText } from '../nbcli.mjs'

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
    timeoutSeconds: 300,
    codeArgs: []
  })

  assert.deepEqual(parseArgs(['exec-code', '--notebook', 't.ipynb', '--timeout', '5', 'print(1)']), {
    command: 'exec-code',
    apiUrl: undefined,
    cwd: undefined,
    notebook: 't.ipynb',
    cell: undefined,
    timeoutSeconds: 5,
    codeArgs: ['print(1)']
  })
})
