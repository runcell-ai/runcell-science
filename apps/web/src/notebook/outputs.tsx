import Anser from 'anser'
import DOMPurify from 'dompurify'
import type { CSSProperties } from 'react'
import type { NotebookDataOutput, NotebookOutput } from './nbformat'
import { joinText } from './nbformat'

/** Keeps pathological outputs (huge logs, giant reprs) from freezing the tab. */
const maxTextLength = 50_000

function AnsiText({ text, className }: { text: string; className: string }) {
  const truncated = text.length > maxTextLength
  const visible = truncated ? text.slice(0, maxTextLength) : text
  const chunks = Anser.ansiToJson(visible, { json: true, remove_empty: true, use_classes: false })
  return (
    <pre className={className}>
      {chunks.map((chunk, index) => {
        const style: CSSProperties = {}
        if (chunk.fg) {
          style.color = `rgb(${chunk.fg})`
        }
        if (chunk.bg) {
          style.backgroundColor = `rgb(${chunk.bg})`
        }
        if (chunk.decoration === 'bold') {
          style.fontWeight = 600
        } else if (chunk.decoration === 'italic') {
          style.fontStyle = 'italic'
        } else if (chunk.decoration === 'underline') {
          style.textDecoration = 'underline'
        }
        return (
          <span key={index} style={style}>
            {chunk.content}
          </span>
        )
      })}
      {truncated ? '\n… output truncated' : null}
    </pre>
  )
}

/**
 * Mimetype priority mirrors Jupyter's convention: richest renderable type
 * wins. HTML that carries <script> (plotly, bokeh, widget snippets) cannot
 * work sanitized, so it falls through to the next available type.
 */
const imageMimeTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

function DataOutputView({ output }: { output: NotebookDataOutput }) {
  const { data } = output

  const html = joinText(data['text/html'])
  if (html && !html.toLowerCase().includes('<script')) {
    return (
      <div
        className="nb-output-html"
        // eslint-disable-next-line react/no-danger -- sanitized; scripts/handlers stripped
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
      />
    )
  }

  const svg = joinText(data['image/svg+xml'])
  if (svg) {
    // <img> keeps SVG inert (no script execution), unlike inlining the markup.
    return (
      <div className="nb-output-media">
        <img src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} alt="SVG output" />
      </div>
    )
  }

  for (const mime of imageMimeTypes) {
    const base64 = joinText(data[mime]).trim()
    if (base64) {
      return (
        <div className="nb-output-media">
          <img src={`data:${mime};base64,${base64}`} alt="Cell output" />
        </div>
      )
    }
  }

  const plain = joinText(data['text/plain'])
  if (plain) {
    return <AnsiText text={plain} className="nb-output-text" />
  }

  const json = data['application/json']
  if (json !== undefined) {
    return <pre className="nb-output-text">{JSON.stringify(json, null, 2)}</pre>
  }

  const mimeTypes = Object.keys(data)
  if (mimeTypes.length === 0) {
    return null
  }
  return (
    <div className="nb-output-unsupported">
      Output type not supported yet: {mimeTypes.join(', ')}
    </div>
  )
}

export function OutputView({ output }: { output: NotebookOutput }) {
  if (output.type === 'stream') {
    return (
      <AnsiText
        text={output.text}
        className={`nb-output-text ${output.name === 'stderr' ? 'nb-output-stderr' : ''}`}
      />
    )
  }
  if (output.type === 'error') {
    return (
      <div className="nb-output-error">
        <AnsiText text={output.traceback || `${output.ename}: ${output.evalue}`} className="nb-output-text" />
      </div>
    )
  }
  return <DataOutputView output={output} />
}
