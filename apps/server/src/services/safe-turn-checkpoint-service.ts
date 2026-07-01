import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { config } from '../config/env'

const gitMaxBuffer = 64 * 1024 * 1024

export type TurnCheckpointCaptureResult =
  | {
      status: 'captured'
      commit: string
    }
  | {
      status: 'skipped'
      reason: string
    }

function runGit(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string } = {}): string {
  return execFileSync('git', args, {
    cwd: options.cwd,
    env: options.env,
    input: options.input,
    encoding: 'utf8',
    maxBuffer: gitMaxBuffer,
    windowsHide: true
  }).toString()
}

function ensureCheckpointStore(checkpointGitDir: string): void {
  if (fs.existsSync(path.join(checkpointGitDir, 'HEAD'))) {
    return
  }

  fs.mkdirSync(path.dirname(checkpointGitDir), { recursive: true })
  runGit(['init', '--bare', checkpointGitDir])
}

function checkpointEnv(indexPath: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_INDEX_FILE: indexPath,
    GIT_AUTHOR_NAME: 'Open Science Checkpoint',
    GIT_AUTHOR_EMAIL: 'checkpoint@open-science.local',
    GIT_COMMITTER_NAME: 'Open Science Checkpoint',
    GIT_COMMITTER_EMAIL: 'checkpoint@open-science.local'
  }
}

function safeRefPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, '_')
}

function checkpointRef(sessionId: string, turnId: string, phase: 'baseline' | 'completed'): string {
  return `refs/open-science/checkpoints/${safeRefPart(sessionId)}/${safeRefPart(turnId)}/${phase}`
}

function gitTrackedAndUntrackedFiles(cwd: string): string[] {
  const output = runGit(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--'], { cwd })
  return output
    .split('\0')
    .filter(Boolean)
    .filter((filePath) => {
      const fullPath = path.join(cwd, filePath)
      try {
        const stats = fs.lstatSync(fullPath)
        return stats.isFile() || stats.isSymbolicLink()
      } catch {
        return false
      }
    })
}

export class SafeTurnCheckpointService {
  constructor(private readonly checkpointGitDir = config.checkpointGitDir) {}

  isGitRepository(cwd: string): boolean {
    try {
      return runGit(['rev-parse', '--is-inside-work-tree'], { cwd }).trim() === 'true'
    } catch {
      return false
    }
  }

  captureSnapshot(input: {
    sessionId: string
    turnId: string
    cwd: string
    phase: 'baseline' | 'completed'
  }): TurnCheckpointCaptureResult {
    if (!this.isGitRepository(input.cwd)) {
      return {
        status: 'skipped',
        reason: 'Working directory is not inside a Git repository.'
      }
    }

    ensureCheckpointStore(this.checkpointGitDir)

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-science-checkpoint-'))
    const indexPath = path.join(tempDir, 'index')
    const pathspecPath = path.join(tempDir, 'pathspecs')
    const env = checkpointEnv(indexPath)

    try {
      const files = gitTrackedAndUntrackedFiles(input.cwd)
      runGit(['--git-dir', this.checkpointGitDir, 'read-tree', '--empty'], { env })

      if (files.length > 0) {
        fs.writeFileSync(pathspecPath, `${files.join('\0')}\0`)
        runGit(
          [
            '--git-dir',
            this.checkpointGitDir,
            '--work-tree',
            input.cwd,
            'add',
            '--pathspec-from-file',
            pathspecPath,
            '--pathspec-file-nul'
          ],
          { env }
        )
      }

      const tree = runGit(['--git-dir', this.checkpointGitDir, 'write-tree'], { env }).trim()
      const commit = runGit(
        [
          '--git-dir',
          this.checkpointGitDir,
          'commit-tree',
          tree,
          '-m',
          `open-science checkpoint ${input.sessionId} ${input.turnId} ${input.phase}`
        ],
        { env }
      ).trim()

      runGit(['--git-dir', this.checkpointGitDir, 'update-ref', checkpointRef(input.sessionId, input.turnId, input.phase), commit])

      return {
        status: 'captured',
        commit
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  }

  diffSnapshots(baselineCommit: string, completedCommit: string): string | null {
    ensureCheckpointStore(this.checkpointGitDir)
    const diff = runGit([
      '--git-dir',
      this.checkpointGitDir,
      'diff',
      '--no-ext-diff',
      '--binary',
      '--find-renames',
      baselineCommit,
      completedCommit,
      '--'
    ]).trimEnd()

    return diff || null
  }
}

export const safeTurnCheckpointService = new SafeTurnCheckpointService()
