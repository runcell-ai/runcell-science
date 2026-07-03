import assert from 'node:assert/strict'
import test from 'node:test'

import { NotebookDoc } from '../src/notebook/notebook-doc'

function fixtureNotebook() {
  return {
    cells: [
      {
        cell_type: 'markdown',
        id: 'intro',
        metadata: { custom: { keep: true } },
        attachments: {
          'plot.png': {
            'image/png': 'abc123'
          }
        },
        source: ['# Intro\n'],
        unexpected_cell_field: { nested: ['preserve'] }
      },
      {
        cell_type: 'code',
        id: 'run',
        execution_count: 3,
        metadata: { tags: ['keep-me'] },
        outputs: [
          {
            output_type: 'stream',
            name: 'stdout',
            text: 'old\n'
          }
        ],
        source: 'print(2)',
        custom_code_field: { still: 'here' }
      }
    ],
    metadata: {
      kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
      language_info: { name: 'python' },
      unknown: { deeply: { preserved: true } }
    },
    nbformat: 4,
    nbformat_minor: 5,
    top_level_custom: ['do', 'not', 'drop']
  }
}

test('NotebookDoc round-trips unknown fields and patches only executed cell outputs/count', () => {
  const original = fixtureNotebook()
  const doc = new NotebookDoc(JSON.stringify(original, null, 2))
  const nextOutputs = [
    {
      output_type: 'execute_result',
      execution_count: 4,
      data: { 'text/plain': '4' },
      metadata: {}
    }
  ]

  doc.setCellOutputs('run', nextOutputs)
  doc.setExecutionCount('run', 4)

  const serialized = JSON.parse(doc.serialize()) as ReturnType<typeof fixtureNotebook>
  assert.deepEqual(serialized.metadata, original.metadata)
  assert.deepEqual(serialized.top_level_custom, original.top_level_custom)
  assert.deepEqual(serialized.cells[0], original.cells[0])
  assert.deepEqual(serialized.cells[1].metadata, original.cells[1].metadata)
  assert.deepEqual(serialized.cells[1].source, original.cells[1].source)
  assert.deepEqual(serialized.cells[1].custom_code_field, original.cells[1].custom_code_field)
  assert.deepEqual(serialized.cells[1].outputs, nextOutputs)
  assert.equal(serialized.cells[1].execution_count, 4)

  const expected = structuredClone(original)
  expected.cells[1].outputs = nextOutputs
  expected.cells[1].execution_count = 4
  assert.deepEqual(serialized, expected)
})

test('NotebookDoc synthesizes stable unique ids for missing and duplicate cell ids', () => {
  const content = JSON.stringify({
    cells: [
      { cell_type: 'code', id: 'same', source: '', execution_count: null, outputs: [] },
      { cell_type: 'code', id: 'same', source: '', execution_count: null, outputs: [] },
      { cell_type: 'markdown', source: 'missing id' },
      { cell_type: 'raw', id: 'cell-2', source: '' }
    ],
    metadata: {},
    nbformat: 4,
    nbformat_minor: 4
  })

  const first = new NotebookDoc(content)
  const second = new NotebookDoc(content)
  const ids = first.document.cells.map((cell) => cell.id)

  assert.deepEqual(ids, ['same', 'same-1', 'cell-2', 'cell-2-1'])
  assert.deepEqual(second.document.cells.map((cell) => cell.id), ids)
})
