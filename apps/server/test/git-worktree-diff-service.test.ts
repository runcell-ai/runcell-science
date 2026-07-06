import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import { currentWorktreeDiff, isGitRepository } from '../src/services/git-worktree-diff-service'

const execFileAsync = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd })
}

test('worktree diff capability is false outside a git repository', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'open-science-no-git-'))
  try {
    assert.equal(await isGitRepository(cwd), false)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('worktree diff includes tracked and untracked changes in a git repository', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'open-science-git-diff-'))
  try {
    await git(cwd, ['init'])
    await git(cwd, ['config', 'user.email', 'test@example.com'])
    await git(cwd, ['config', 'user.name', 'Runcell Science Test'])
    await mkdir(path.join(cwd, 'src'))
    await writeFile(path.join(cwd, 'src', 'tracked.txt'), 'before\n')
    await git(cwd, ['add', '.'])
    await git(cwd, ['commit', '-m', 'initial'])

    await writeFile(path.join(cwd, 'src', 'tracked.txt'), 'after\n')
    await writeFile(path.join(cwd, 'src', 'untracked.txt'), 'new file\n')

    const diff = await currentWorktreeDiff(cwd)
    assert.equal(await isGitRepository(cwd), true)
    assert.ok(diff?.includes('diff --git a/src/tracked.txt b/src/tracked.txt'))
    assert.ok(diff?.includes('-before'))
    assert.ok(diff?.includes('+after'))
    assert.ok(diff?.includes('diff --git a/src/untracked.txt b/src/untracked.txt'))
    assert.ok(diff?.includes('+new file'))
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
