import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const gitMaxBuffer = 24 * 1024 * 1024

type ExecFileError = Error & {
  code?: number | string
  stdout?: unknown
}

function outputToString(value: unknown): string {
  if (Buffer.isBuffer(value)) {
    return value.toString('utf8')
  }
  return typeof value === 'string' ? value : ''
}

function isExecFileError(value: unknown): value is ExecFileError {
  return value instanceof Error
}

async function runGit(cwd: string, args: string[], acceptedExitCodes: number[] = [0]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: gitMaxBuffer,
      windowsHide: true
    })
    return outputToString(stdout)
  } catch (error) {
    if (isExecFileError(error) && typeof error.code === 'number' && acceptedExitCodes.includes(error.code)) {
      return outputToString(error.stdout)
    }
    throw error
  }
}

async function trackedWorktreeDiff(cwd: string): Promise<string> {
  try {
    return await runGit(cwd, ['diff', '--no-ext-diff', '--binary', 'HEAD', '--'])
  } catch {
    return runGit(cwd, ['diff', '--no-ext-diff', '--binary', '--'])
  }
}

async function untrackedFiles(cwd: string): Promise<string[]> {
  const output = await runGit(cwd, ['ls-files', '--others', '--exclude-standard', '-z'])
  return output.split('\0').filter(Boolean)
}

async function untrackedFileDiff(cwd: string, filePath: string): Promise<string> {
  return runGit(cwd, ['diff', '--no-ext-diff', '--binary', '--no-index', '--', '/dev/null', filePath], [0, 1])
}

export async function isGitRepository(cwd: string): Promise<boolean> {
  try {
    return (await runGit(cwd, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true'
  } catch {
    return false
  }
}

export async function currentWorktreeDiff(cwd: string): Promise<string | null> {
  const tracked = await trackedWorktreeDiff(cwd)
  const untracked = await Promise.all((await untrackedFiles(cwd)).map((filePath) => untrackedFileDiff(cwd, filePath)))
  const unifiedDiff = [tracked, ...untracked]
    .map((patch) => patch.trimEnd())
    .filter(Boolean)
    .join('\n')

  return unifiedDiff || null
}
