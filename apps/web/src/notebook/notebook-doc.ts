import type { NotebookCell, NotebookDocument, NotebookOutput } from './nbformat'

export type NotebookRawObject = Record<string, unknown>
export type NotebookRawOutput = Record<string, unknown>

function isRecord(value: unknown): value is NotebookRawObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** nbformat stores text as either a string or a list of line strings. */
export function joinText(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    return value.filter((part): part is string => typeof part === 'string').join('')
  }
  return ''
}

function parseOutput(raw: unknown): NotebookOutput | null {
  if (!isRecord(raw)) {
    return null
  }
  if (raw.output_type === 'stream') {
    return {
      type: 'stream',
      name: typeof raw.name === 'string' ? raw.name : 'stdout',
      text: joinText(raw.text)
    }
  }
  if (raw.output_type === 'error') {
    const traceback = Array.isArray(raw.traceback)
      ? raw.traceback.filter((line): line is string => typeof line === 'string').join('\n')
      : joinText(raw.traceback)
    return {
      type: 'error',
      ename: typeof raw.ename === 'string' ? raw.ename : 'Error',
      evalue: typeof raw.evalue === 'string' ? raw.evalue : '',
      traceback
    }
  }
  if (raw.output_type === 'display_data' || raw.output_type === 'execute_result') {
    return {
      type: raw.output_type,
      data: isRecord(raw.data) ? raw.data : {},
      executionCount: typeof raw.execution_count === 'number' ? raw.execution_count : null
    }
  }
  return null
}

function uniqueCellId(rawId: unknown, index: number, seen: Set<string>): string {
  const base = typeof rawId === 'string' && rawId.length > 0 ? rawId : `cell-${index}`
  let candidate = base
  let suffix = 1
  while (seen.has(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  seen.add(candidate)
  return candidate
}

function normalizeCellIds(cells: unknown[]): void {
  const seen = new Set<string>()
  for (let index = 0; index < cells.length; index += 1) {
    const raw = cells[index]
    if (!isRecord(raw)) {
      continue
    }
    const id = uniqueCellId(raw.id, index, seen)
    if (raw.id !== id) {
      raw.id = id
    }
  }
}

function parseCell(raw: unknown): NotebookCell | null {
  if (!isRecord(raw)) {
    return null
  }
  const type = raw.cell_type === 'markdown' || raw.cell_type === 'raw' ? raw.cell_type : 'code'
  const outputs =
    type === 'code' && Array.isArray(raw.outputs)
      ? raw.outputs.map(parseOutput).filter((output): output is NotebookOutput => output !== null)
      : []
  return {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : 'cell',
    type,
    source: joinText(raw.source),
    executionCount: typeof raw.execution_count === 'number' ? raw.execution_count : null,
    outputs
  }
}

function renderModel(raw: NotebookRawObject): NotebookDocument {
  let languageName = 'python'
  if (isRecord(raw.metadata)) {
    const languageInfo = raw.metadata.language_info
    const kernelspec = raw.metadata.kernelspec
    if (isRecord(languageInfo) && typeof languageInfo.name === 'string') {
      languageName = languageInfo.name
    } else if (isRecord(kernelspec) && typeof kernelspec.language === 'string') {
      languageName = kernelspec.language
    }
  }

  const cells = Array.isArray(raw.cells) ? raw.cells : []
  return {
    cells: cells.map(parseCell).filter((cell): cell is NotebookCell => cell !== null),
    languageName
  }
}

export class NotebookDoc {
  private readonly raw: NotebookRawObject
  private model: NotebookDocument

  constructor(content: string) {
    const json: unknown = JSON.parse(content)
    if (!isRecord(json) || !Array.isArray(json.cells)) {
      throw new Error('Not a Jupyter notebook: missing "cells".')
    }
    normalizeCellIds(json.cells)
    this.raw = json
    this.model = renderModel(this.raw)
  }

  get document(): NotebookDocument {
    return this.model
  }

  setCellOutputs(cellId: string, outputs: NotebookRawOutput[]): void {
    const cell = this.rawCell(cellId)
    if (!cell || cell.cell_type !== 'code') {
      return
    }
    cell.outputs = outputs.map((output) => ({ ...output }))
    this.refreshModel()
  }

  setExecutionCount(cellId: string, count: number | null): void {
    const cell = this.rawCell(cellId)
    if (!cell || cell.cell_type !== 'code') {
      return
    }
    cell.execution_count = count
    this.refreshModel()
  }

  clearCellOutputs(cellId: string): void {
    this.setCellOutputs(cellId, [])
  }

  toJSON(): NotebookRawObject {
    return this.raw
  }

  serialize(): string {
    return `${JSON.stringify(this.raw, null, 2)}\n`
  }

  private rawCell(cellId: string): NotebookRawObject | null {
    const cells = Array.isArray(this.raw.cells) ? this.raw.cells : []
    for (const cell of cells) {
      if (isRecord(cell) && cell.id === cellId) {
        return cell
      }
    }
    return null
  }

  private refreshModel(): void {
    this.model = renderModel(this.raw)
  }
}

export function createNotebookDoc(content: string): NotebookDoc {
  return new NotebookDoc(content)
}
