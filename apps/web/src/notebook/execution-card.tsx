import type { AgentTimelineItem } from '@runcell-science/ui'

import { parseOutput } from './notebook-doc'
import { joinText } from './nbformat'
import { OutputView } from './outputs'

type NotebookExecutionItem = Extract<AgentTimelineItem, { type: 'notebook-execution' }>

function statusGlyph(status: NotebookExecutionItem['detail']['status']): string {
  if (status === 'ok') {
    return '✓'
  }
  if (status === 'timeout') {
    return '⏱'
  }
  return '✗'
}

function outputLineCount(raw: Record<string, unknown>): number {
  if (raw.output_type === 'stream') {
    return joinText(raw.text).split('\n').length
  }
  if (raw.output_type === 'error') {
    return (Array.isArray(raw.traceback) ? raw.traceback.join('\n') : joinText(raw.traceback)).split('\n').length
  }
  if (
    (raw.output_type === 'display_data' || raw.output_type === 'execute_result') &&
    raw.data &&
    typeof raw.data === 'object' &&
    !Array.isArray(raw.data)
  ) {
    return joinText((raw.data as Record<string, unknown>)['text/plain']).split('\n').length
  }
  return 0
}

export function NotebookExecutionCard({ item }: { item: NotebookExecutionItem }) {
  const { detail } = item
  const label = detail.cellId ?? 'exec-code'
  const parsedOutputs = detail.outputs
    .map((output) => ({ raw: output, parsed: parseOutput(output) }))
    .filter((entry): entry is { raw: Record<string, unknown>; parsed: NonNullable<ReturnType<typeof parseOutput>> } => entry.parsed !== null)

  return (
    <article className={`timeline-row nb-exec-row nb-exec-${detail.status}`}>
      <div className="nb-exec-card">
        <header className="nb-exec-header">
          <span className="nb-exec-status" aria-label={detail.status}>
            {statusGlyph(detail.status)}
          </span>
          <span className="nb-exec-path">{detail.notebook}</span>
          <span className="nb-exec-cell">{label}</span>
          {typeof detail.executionCount === 'number' ? (
            <span className="nb-exec-count">[{detail.executionCount}]</span>
          ) : null}
          {detail.truncated ? <span className="nb-exec-truncated">(truncated)</span> : null}
        </header>
        {parsedOutputs.length > 0 ? (
          <div className="nb-exec-outputs">
            {parsedOutputs.map(({ raw, parsed }, index) => {
              const output = <OutputView output={parsed} />
              return outputLineCount(raw) > 12 ? (
                <details key={index} className="nb-exec-output-details">
                  <summary>Show full output</summary>
                  {output}
                </details>
              ) : (
                <div key={index} className="nb-exec-output">
                  {output}
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
    </article>
  )
}
