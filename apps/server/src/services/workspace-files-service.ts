import fs from 'node:fs'
import path from 'node:path'

import type { WorkspaceFile, WorkspaceFileKind } from '@open-science/contracts'

/** Hard cap on files returned from a single walk, to keep the response bounded
 * for large workspaces. When exceeded the response is flagged `truncated`. */
const maxFiles = 800
const maxDepth = 6

/** Directories that never contain user-facing artifacts and would otherwise
 * dominate the walk (dependencies, build output, caches, VCS internals). */
const ignoredDirectories = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.turbo',
  '.cache',
  '.parcel-cache',
  'coverage',
  '.venv',
  'venv',
  'env',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.ipynb_checkpoints',
  'target',
  '.gradle',
  '.idea'
])

const imageExtensions = new Set(['.apng', '.avif', '.bmp', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp'])
const markdownExtensions = new Set(['.markdown', '.md', '.mdown', '.mkd'])
const textExtensions = new Set([
  '.txt',
  '.log',
  '.csv',
  '.tsv',
  '.json',
  '.jsonl',
  '.ndjson',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.env',
  '.py',
  '.ipynb',
  '.r',
  '.rmd',
  '.jl',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.sh',
  '.bash',
  '.zsh',
  '.sql',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.rs',
  '.go',
  '.java',
  '.rb',
  '.php',
  '.css',
  '.scss',
  '.xml',
  '.tex',
  '.bib',
  '.fasta',
  '.fa',
  '.fastq',
  '.gff',
  '.gtf',
  '.bed',
  '.vcf',
  '.nwk',
  '.newick',
  '.tree',
  '.iqtree',
  '.nex',
  '.phy',
  '.aln'
])

export function classifyWorkspaceFile(filePath: string): WorkspaceFileKind {
  const extension = path.extname(filePath).toLowerCase()
  if (imageExtensions.has(extension)) {
    return 'image'
  }
  if (extension === '.pdf') {
    return 'pdf'
  }
  if (markdownExtensions.has(extension)) {
    return 'markdown'
  }
  if (extension === '.html' || extension === '.htm') {
    return 'html'
  }
  if (textExtensions.has(extension)) {
    return 'text'
  }
  return 'other'
}

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join('/')
}

export interface WorkspaceFilesResult {
  root: string
  isDirectory: boolean
  files: WorkspaceFile[]
  truncated: boolean
}

export function listWorkspaceFiles(cwd: string): WorkspaceFilesResult {
  let rootReal: string
  try {
    rootReal = fs.realpathSync(cwd)
  } catch {
    return { root: cwd, isDirectory: false, files: [], truncated: false }
  }

  if (!fs.statSync(rootReal).isDirectory()) {
    return { root: rootReal, isDirectory: false, files: [], truncated: false }
  }

  const files: WorkspaceFile[] = []
  let truncated = false

  const walk = (dir: string, depth: number): void => {
    if (truncated || depth > maxDepth) {
      return
    }

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    // Files before descending, and alphabetical, so a truncated walk still
    // returns coherent top-level results rather than one deep branch.
    const sorted = [...entries].sort((left, right) => left.name.localeCompare(right.name))
    const directories: string[] = []

    for (const entry of sorted) {
      if (entry.name.startsWith('.')) {
        continue
      }

      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          directories.push(path.join(dir, entry.name))
        }
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      if (files.length >= maxFiles) {
        truncated = true
        return
      }

      const absolute = path.join(dir, entry.name)
      let stat: fs.Stats
      try {
        stat = fs.statSync(absolute)
      } catch {
        continue
      }

      files.push({
        path: toPosix(path.relative(rootReal, absolute)),
        name: entry.name,
        kind: classifyWorkspaceFile(entry.name),
        size: stat.size,
        modifiedAt: stat.mtime.toISOString()
      })
    }

    for (const child of directories) {
      if (truncated) {
        return
      }
      walk(child, depth + 1)
    }
  }

  walk(rootReal, 0)

  files.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))

  return { root: rootReal, isDirectory: true, files, truncated }
}
