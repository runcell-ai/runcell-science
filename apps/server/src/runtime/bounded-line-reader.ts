import type { Readable } from 'node:stream'

export function readBoundedLines(
  stream: Readable,
  maxLineBytes: number,
  onLine: (line: string) => void,
  onOverflow: () => void
): () => void {
  let chunks: Buffer[] = []
  let bufferedBytes = 0
  let overflowed = false

  const append = (segment: Buffer): boolean => {
    if (bufferedBytes + segment.length > maxLineBytes) {
      overflowed = true
      chunks = []
      bufferedBytes = 0
      onOverflow()
      return false
    }
    if (segment.length > 0) {
      chunks.push(Buffer.from(segment))
      bufferedBytes += segment.length
    }
    return true
  }

  const emitLine = () => {
    const line = Buffer.concat(chunks, bufferedBytes).toString('utf8').replace(/\r$/, '')
    chunks = []
    bufferedBytes = 0
    onLine(line)
  }

  const handleData = (input: Buffer | string) => {
    if (overflowed) {
      return
    }
    const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input)
    let start = 0
    for (;;) {
      const newline = buffer.indexOf(10, start)
      const end = newline === -1 ? buffer.length : newline
      if (!append(buffer.subarray(start, end))) {
        return
      }
      if (newline === -1) {
        return
      }
      emitLine()
      start = newline + 1
    }
  }

  const handleEnd = () => {
    if (!overflowed && bufferedBytes > 0) {
      emitLine()
    }
  }

  stream.on('data', handleData)
  stream.on('end', handleEnd)

  return () => {
    stream.off('data', handleData)
    stream.off('end', handleEnd)
    chunks = []
    bufferedBytes = 0
    overflowed = true
  }
}
