import type {
  AgentDiffFileChange,
  AgentTurnDiff
} from '@open-science/contracts'
import { PatchDiff } from '@pierre/diffs/react'
import {
  FileDiff,
  FileMinus,
  FilePenLine,
  FilePlus
} from 'lucide-react'

const patchDiffOptions = {
  diffStyle: 'unified',
  overflow: 'scroll',
  lineDiffType: 'word',
  hunkSeparators: 'line-info-basic',
  collapsedContextThreshold: 8,
  tokenizeMaxLineLength: 2000
} as const

type DiffPatch = {
  id: string
  title: string
  patch: string
  kind?: AgentDiffFileChange['kind']
}

type HunkLineCounts = {
  oldRemaining: number
  newRemaining: number
}

type AgentDiffContent = Pick<AgentTurnDiff, 'files' | 'unifiedDiff'>

function AgentDiffView({
  diff,
  title = 'File changes'
}: {
  diff: AgentDiffContent
  title?: string
}) {
  const patches = diff.files.length > 0 ? patchesFromFileChanges(diff.files) : patchesFromUnifiedDiff(diff.unifiedDiff)
  const fileCount = patches.length

  return (
    <div className="diff-card">
      <div className="diff-card-header">
        <div className="diff-card-title">
          <FileDiff />
          <span>{title}</span>
        </div>
        <span className="diff-count">{fileCountLabel(fileCount)}</span>
      </div>

      {patches.length > 0 ? (
        <div className="diff-file-list">
          {patches.map((patch, index) => (
            <details key={patch.id} className="diff-file" open={index === 0}>
              <summary className="diff-file-summary">
                {patch.kind ? <DiffFileKindIcon kind={patch.kind} /> : null}
                <span>{patch.title}</span>
              </summary>
              <DiffPatchBlock patch={patch.patch} />
            </details>
          ))}
        </div>
      ) : (
        <div className="diff-empty">No diff content</div>
      )}
    </div>
  )
}

function DiffPatchBlock({ patch }: { patch: string }) {
  if (!isPatchRenderable(patch)) {
    return <pre className="diff-raw">{patch.trim() || 'No diff content'}</pre>
  }

  return (
    <div className="diff-patch">
      <PatchDiff patch={patch} options={patchDiffOptions} disableWorkerPool />
    </div>
  )
}

function patchesFromFileChanges(files: AgentDiffFileChange[]): DiffPatch[] {
  return files.map((file, index) => ({
    id: `${file.path}:${index}`,
    title: fileTitle(file),
    patch: ensurePatchHeader(file),
    kind: file.kind
  }))
}

function patchesFromUnifiedDiff(unifiedDiff: string | null): DiffPatch[] {
  if (!unifiedDiff?.trim()) {
    return []
  }

  return splitUnifiedDiff(unifiedDiff).map((patch, index) => ({
    id: `patch:${index}`,
    title: titleFromPatch(patch, index),
    patch
  }))
}

function splitUnifiedDiff(unifiedDiff: string): string[] {
  const gitStarts = [...unifiedDiff.matchAll(/^diff --git .+$/gm)].map((match) => match.index ?? 0)
  const starts = gitStarts.length > 0 ? gitStarts : standardUnifiedDiffStarts(unifiedDiff)
  if (starts.length <= 1) {
    return [unifiedDiff]
  }

  return starts.map((start, index) => {
    const end = starts[index + 1] ?? unifiedDiff.length
    return unifiedDiff.slice(start, end).trimEnd()
  })
}

function standardUnifiedDiffStarts(unifiedDiff: string): number[] {
  const lines = unifiedDiff.split('\n')
  const starts: number[] = []
  let hunkLineCounts: HunkLineCounts | null = null
  let offset = 0

  for (let index = 0; index < lines.length - 1; index += 1) {
    const line = lines[index] ?? ''

    if (hunkLineCounts) {
      hunkLineCounts = consumeHunkLine(hunkLineCounts, line)
      offset += line.length + 1
      continue
    }

    const nextHunkLineCounts = parseHunkLineCounts(line)
    if (nextHunkLineCounts) {
      hunkLineCounts = isHunkComplete(nextHunkLineCounts) ? null : nextHunkLineCounts
      offset += line.length + 1
      continue
    }

    if (line.startsWith('--- ') && lines[index + 1]?.startsWith('+++ ')) {
      starts.push(offset)
    }
    offset += line.length + 1
  }

  return starts
}

function parseHunkLineCounts(line: string): HunkLineCounts | null {
  const match = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line)
  if (!match) {
    return null
  }

  return {
    oldRemaining: match[1] === undefined ? 1 : Number(match[1]),
    newRemaining: match[2] === undefined ? 1 : Number(match[2])
  }
}

function consumeHunkLine(counts: HunkLineCounts, line: string): HunkLineCounts | null {
  if (line.startsWith('\\')) {
    return counts
  }

  let { oldRemaining, newRemaining } = counts
  if (line.startsWith('+')) {
    newRemaining = Math.max(0, newRemaining - 1)
  } else if (line.startsWith('-')) {
    oldRemaining = Math.max(0, oldRemaining - 1)
  } else {
    oldRemaining = Math.max(0, oldRemaining - 1)
    newRemaining = Math.max(0, newRemaining - 1)
  }

  const nextCounts = { oldRemaining, newRemaining }
  return isHunkComplete(nextCounts) ? null : nextCounts
}

function isHunkComplete(counts: HunkLineCounts): boolean {
  return counts.oldRemaining === 0 && counts.newRemaining === 0
}

function ensurePatchHeader(file: AgentDiffFileChange): string {
  const trimmed = file.diff.trimStart()
  if (trimmed.startsWith('diff --git ') || trimmed.startsWith('--- ')) {
    return file.diff
  }

  const previousPath = file.previousPath ?? file.path
  const oldPath = file.kind === 'add' ? '/dev/null' : `a/${previousPath}`
  const newPath = file.kind === 'delete' ? '/dev/null' : `b/${file.path}`

  return `diff --git a/${previousPath} b/${file.path}\n--- ${oldPath}\n+++ ${newPath}\n${file.diff}`
}

function isPatchRenderable(patch: string): boolean {
  return /^@@\s/m.test(patch) && /^---\s/m.test(patch) && /^\+\+\+\s/m.test(patch)
}

function titleFromPatch(patch: string, index: number): string {
  const gitHeader = patch.match(/^diff --git a\/(.+) b\/(.+)$/m)
  if (gitHeader?.[2]) {
    return gitHeader[2]
  }

  const newFile = patch.match(/^\+\+\+\s+(?:b\/)?(.+)$/m)
  if (newFile?.[1]) {
    return newFile[1]
  }

  return `Patch ${index + 1}`
}

function fileTitle(file: AgentDiffFileChange): string {
  const label = changeKindLabel(file.kind)
  if (file.previousPath && file.previousPath !== file.path) {
    return `${label}: ${file.previousPath} -> ${file.path}`
  }

  return `${label}: ${file.path}`
}

function changeKindLabel(kind: AgentDiffFileChange['kind']): string {
  switch (kind) {
    case 'add':
      return 'Added'
    case 'delete':
      return 'Deleted'
    case 'update':
      return 'Modified'
  }
}

function fileCountLabel(count: number): string {
  return `${count} file${count === 1 ? '' : 's'}`
}

function DiffFileKindIcon({ kind }: { kind: AgentDiffFileChange['kind'] }) {
  switch (kind) {
    case 'add':
      return <FilePlus className="diff-kind-icon diff-kind-added" />
    case 'delete':
      return <FileMinus className="diff-kind-icon diff-kind-deleted" />
    case 'update':
      return <FilePenLine className="diff-kind-icon diff-kind-modified" />
  }
}

export { AgentDiffView }
