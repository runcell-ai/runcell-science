import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { ClipboardEvent, DragEvent, KeyboardEvent } from 'react'

export type EditableInputHandle = {
  focus: () => void
  getText: () => string
  getCaret: () => number
  setCaret: (offset: number) => void
}

type EditableInputProps = {
  value: string
  disabled?: boolean
  placeholder?: string
  className?: string
  ariaLabel?: string
  /** Fires with the plain-text value and the caret's character offset. */
  onChange: (value: string, caret: number) => void
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
}

/**
 * Serialize a node subtree to plain text. Newlines only ever come from real "\n"
 * characters in text nodes (Enter and paste insert them as text), so any <br> is
 * a browser-inserted filler for an empty line and serializes to nothing.
 */
function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? ''
  }
  if (node.nodeName === 'BR') {
    return ''
  }
  let text = ''
  node.childNodes.forEach((child) => {
    text += serializeNode(child)
  })
  return text
}

function readText(el: HTMLElement): string {
  let text = ''
  el.childNodes.forEach((child) => {
    text += serializeNode(child)
  })
  return text
}

/** Character offset from the start of `el` to the DOM point (container, offset). */
function lengthBefore(el: HTMLElement, container: Node, offset: number): number {
  if (container === el) {
    let count = 0
    for (let i = 0; i < offset; i++) {
      const child = el.childNodes[i]
      if (child) count += serializeNode(child).length
    }
    return count
  }

  let count = 0
  let done = false
  const visit = (node: Node) => {
    if (done) return
    if (node === container) {
      if (node.nodeType === Node.TEXT_NODE) {
        count += offset
      } else {
        for (let i = 0; i < offset; i++) {
          const child = node.childNodes[i]
          if (child) count += serializeNode(child).length
        }
      }
      done = true
      return
    }
    if (node.nodeType === Node.TEXT_NODE) {
      count += node.textContent?.length ?? 0
      return
    }
    if (node.nodeName === 'BR') {
      return
    }
    node.childNodes.forEach(visit)
  }
  el.childNodes.forEach(visit)
  return count
}

function readCaret(el: HTMLElement): number {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) {
    return readText(el).length
  }
  const range = selection.getRangeAt(0)
  if (!el.contains(range.endContainer)) {
    return readText(el).length
  }
  return lengthBefore(el, range.endContainer, range.endOffset)
}

function placeCaret(el: HTMLElement, offset: number) {
  const selection = window.getSelection()
  if (!selection) return

  const total = readText(el).length
  let remaining = Math.max(0, Math.min(offset, total))
  let target: Text | null = null
  let localOffset = 0

  const visit = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent?.length ?? 0
      if (remaining <= len) {
        target = node as Text
        localOffset = remaining
        return true
      }
      remaining -= len
      return false
    }
    if (node.nodeName === 'BR') {
      return false
    }
    for (const child of Array.from(node.childNodes)) {
      if (visit(child)) return true
    }
    return false
  }

  for (const child of Array.from(el.childNodes)) {
    if (visit(child)) break
  }

  const range = document.createRange()
  if (target) {
    range.setStart(target, localOffset)
    range.collapse(true)
  } else {
    range.selectNodeContents(el)
    range.collapse(false)
  }
  selection.removeAllRanges()
  selection.addRange(range)
}

/** Resolve a DOM caret range from viewport coordinates, across browsers. */
function caretRangeFromPoint(x: number, y: number): Range | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  if (typeof doc.caretRangeFromPoint === 'function') {
    return doc.caretRangeFromPoint(x, y)
  }
  const position = doc.caretPositionFromPoint?.(x, y)
  if (!position) return null
  const range = document.createRange()
  range.setStart(position.offsetNode, position.offset)
  range.collapse(true)
  return range
}

/** Insert plain text at the current caret, replacing any selection. */
function insertText(el: HTMLElement, text: string) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || !el.contains(selection.anchorNode)) {
    el.textContent = readText(el) + text
    placeCaret(el, readText(el).length)
    return
  }
  const range = selection.getRangeAt(0)
  range.deleteContents()
  const node = document.createTextNode(text)
  range.insertNode(node)
  range.setStartAfter(node)
  range.setEndAfter(node)
  selection.removeAllRanges()
  selection.addRange(range)
}

/**
 * A controlled plain-text editor built on a contentEditable div. It behaves like
 * a textarea (multi-line, controlled value, placeholder) but is a real element
 * we own, so callers can style content and manage the caret precisely.
 *
 * Newlines render via `white-space: pre-wrap`; Enter inserts "\n" so the DOM
 * never grows nested block elements. IME composition (e.g. Chinese) is tracked
 * so intermediate characters are never torn down mid-compose.
 */
const EditableInput = forwardRef<EditableInputHandle, EditableInputProps>(function EditableInput(
  { value, disabled = false, placeholder, className, ariaLabel, onChange, onKeyDown },
  ref
) {
  const elRef = useRef<HTMLDivElement | null>(null)
  const composingRef = useRef(false)
  // Mirror of composingRef for rendering: the placeholder must hide while an IME
  // composition is in flight, even though `value` stays empty until it commits.
  const [composing, setComposing] = useState(false)

  useImperativeHandle(
    ref,
    () => ({
      focus: () => elRef.current?.focus(),
      getText: () => (elRef.current ? readText(elRef.current) : ''),
      getCaret: () => (elRef.current ? readCaret(elRef.current) : 0),
      setCaret: (offset: number) => {
        if (elRef.current) placeCaret(elRef.current, offset)
      }
    }),
    []
  )

  // Sync the DOM from the controlled value only for external changes (clearing
  // after send, inserting a skill). Skipped mid-composition so IME state stays
  // intact, and skipped when they already match so typing never jumps the caret.
  useLayoutEffect(() => {
    const el = elRef.current
    if (!el || composingRef.current) return
    if (readText(el) !== value) {
      el.textContent = value
    }
  }, [value])

  function emit() {
    const el = elRef.current
    if (!el) return
    onChange(readText(el), readCaret(el))
  }

  function handleInput() {
    if (composingRef.current) return
    emit()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    if (event.nativeEvent.isComposing || composingRef.current) return
    if (event.key === 'Enter') {
      // Any unhandled Enter = newline. The composer intercepts Cmd/Ctrl+Enter
      // (send) and skill-menu selection before this runs.
      event.preventDefault()
      if (elRef.current) {
        insertText(elRef.current, '\n')
        emit()
      }
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault()
    const text = event.clipboardData.getData('text/plain')
    if (!text || !elRef.current) return
    insertText(elRef.current, text)
    emit()
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    // Never let a drop inject rich nodes; take the plain text at the drop point.
    event.preventDefault()
    const el = elRef.current
    const text = event.dataTransfer.getData('text/plain')
    if (!text || !el) return
    const point = caretRangeFromPoint(event.clientX, event.clientY)
    if (point && el.contains(point.startContainer)) {
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(point)
    } else {
      el.focus()
    }
    insertText(el, text)
    emit()
  }

  return (
    <div
      ref={elRef}
      className={className}
      role="textbox"
      aria-multiline="true"
      aria-label={ariaLabel}
      data-empty={value.length === 0}
      data-composing={composing}
      data-placeholder={placeholder}
      contentEditable={!disabled}
      suppressContentEditableWarning
      spellCheck
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onDrop={handleDrop}
      onCompositionStart={() => {
        composingRef.current = true
        setComposing(true)
      }}
      onCompositionEnd={() => {
        composingRef.current = false
        setComposing(false)
        emit()
      }}
    />
  )
})

export { EditableInput }
