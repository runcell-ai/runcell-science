/**
 * Minimal nbformat 4.x document model for read-only rendering.
 *
 * Cells are addressed by nbformat cell `id` everywhere (ids are synthesized
 * for pre-4.5 notebooks that lack them); execution and live-sync layers added
 * later must keep using the same ids.
 */

export type NotebookCellType = 'code' | 'markdown' | 'raw'

export interface NotebookStreamOutput {
  type: 'stream'
  /** 'stdout' | 'stderr' */
  name: string
  text: string
}

export interface NotebookDataOutput {
  type: 'display_data' | 'execute_result'
  /** Raw mimebundle: mimetype -> string | string[] | JSON value. */
  data: Record<string, unknown>
  executionCount: number | null
}

export interface NotebookErrorOutput {
  type: 'error'
  ename: string
  evalue: string
  /** Joined traceback lines; usually contains ANSI escape codes. */
  traceback: string
}

export type NotebookOutput = NotebookStreamOutput | NotebookDataOutput | NotebookErrorOutput

export interface NotebookCell {
  id: string
  type: NotebookCellType
  source: string
  executionCount: number | null
  outputs: NotebookOutput[]
}

export interface NotebookDocument {
  cells: NotebookCell[]
  languageName: string
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

function parseCell(raw: unknown, index: number): NotebookCell | null {
  if (!isRecord(raw)) {
    return null
  }
  const type: NotebookCellType =
    raw.cell_type === 'markdown' || raw.cell_type === 'raw' ? raw.cell_type : 'code'
  const outputs =
    type === 'code' && Array.isArray(raw.outputs)
      ? raw.outputs.map(parseOutput).filter((output): output is NotebookOutput => output !== null)
      : []
  return {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : `cell-${index}`,
    type,
    source: joinText(raw.source),
    executionCount: typeof raw.execution_count === 'number' ? raw.execution_count : null,
    outputs
  }
}

/** Throws on malformed JSON or non-notebook documents; callers show a fallback. */
export function parseNotebook(content: string): NotebookDocument {
  const json: unknown = JSON.parse(content)
  if (!isRecord(json) || !Array.isArray(json.cells)) {
    throw new Error('Not a Jupyter notebook: missing "cells".')
  }

  let languageName = 'python'
  if (isRecord(json.metadata)) {
    const languageInfo = json.metadata.language_info
    const kernelspec = json.metadata.kernelspec
    if (isRecord(languageInfo) && typeof languageInfo.name === 'string') {
      languageName = languageInfo.name
    } else if (isRecord(kernelspec) && typeof kernelspec.language === 'string') {
      languageName = kernelspec.language
    }
  }

  return {
    cells: json.cells.map(parseCell).filter((cell): cell is NotebookCell => cell !== null),
    languageName
  }
}
