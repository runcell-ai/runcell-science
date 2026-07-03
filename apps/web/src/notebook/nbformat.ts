/**
 * Minimal nbformat 4.x render model.
 *
 * Cells are addressed by nbformat cell `id` everywhere. The document store
 * synthesizes ids for missing/duplicate ids before deriving this model.
 */
import { NotebookDoc, joinText } from './notebook-doc'

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

export { joinText }

/** Throws on malformed JSON or non-notebook documents; callers show a fallback. */
export function parseNotebook(content: string): NotebookDocument {
  return new NotebookDoc(content).document
}
