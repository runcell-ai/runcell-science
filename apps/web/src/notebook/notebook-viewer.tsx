import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'
import { parseNotebook } from './nbformat'
import type { NotebookDocument } from './nbformat'
import { OutputView } from './outputs'

type ParseResult = { doc: NotebookDocument; error: null } | { doc: null; error: string }

/**
 * Read-only .ipynb renderer. Loaded lazily from the artifacts panel so the
 * markdown/KaTeX stack stays out of the main bundle.
 */
export default function NotebookViewer({ content }: { content: string }) {
  const parsed = useMemo<ParseResult>(() => {
    try {
      return { doc: parseNotebook(content), error: null }
    } catch (error) {
      return { doc: null, error: error instanceof Error ? error.message : String(error) }
    }
  }, [content])

  if (!parsed.doc) {
    return (
      <div className="nb-root">
        <div className="nb-parse-error">Couldn’t render this notebook: {parsed.error}</div>
        <pre className="preview-text">{content.slice(0, 50_000)}</pre>
      </div>
    )
  }

  if (parsed.doc.cells.length === 0) {
    return <div className="side-panel-empty">This notebook has no cells.</div>
  }

  return (
    <div className="nb-root">
      {parsed.doc.cells.map((cell) =>
        cell.type === 'markdown' ? (
          <section key={cell.id} className="nb-cell nb-cell-markdown">
            <article className="artifact-markdown nb-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                {cell.source}
              </ReactMarkdown>
            </article>
          </section>
        ) : (
          <section key={cell.id} className={`nb-cell nb-cell-${cell.type}`}>
            <div className="nb-source-row">
              <span className="nb-exec-count">
                {cell.type === 'code' ? `[${cell.executionCount ?? ' '}]` : ''}
              </span>
              <pre className="nb-source">{cell.source}</pre>
            </div>
            {cell.outputs.length > 0 ? (
              <div className="nb-outputs">
                {cell.outputs.map((output, index) => (
                  <OutputView key={index} output={output} />
                ))}
              </div>
            ) : null}
          </section>
        )
      )}
    </div>
  )
}
