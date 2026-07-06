import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { SafeTurnCheckpointService } from '../src/services/safe-turn-checkpoint-service'

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  }).toString()
}

test('safe turn checkpoints diff snapshots without writing refs into the target repository', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'open-science-safe-checkpoint-repo-'))
  const checkpointGitDir = path.join(os.tmpdir(), `open-science-safe-checkpoints-${process.pid}-${Date.now()}.git`)

  try {
    git(cwd, ['init'])
    git(cwd, ['config', 'user.email', 'test@example.com'])
    git(cwd, ['config', 'user.name', 'Runcell Science Test'])
    mkdirSync(path.join(cwd, 'src'))
    writeFileSync(path.join(cwd, 'src', 'sample.txt'), 'before\n')
    git(cwd, ['add', '.'])
    git(cwd, ['commit', '-m', 'initial'])

    const service = new SafeTurnCheckpointService(checkpointGitDir)
    const baseline = service.captureSnapshot({
      sessionId: 'session-test',
      turnId: 'turn-test',
      cwd,
      phase: 'baseline'
    })
    assert.equal(baseline.status, 'captured')

    writeFileSync(path.join(cwd, 'src', 'sample.txt'), 'after\n')
    writeFileSync(path.join(cwd, 'src', 'new.txt'), 'new\n')

    const completed = service.captureSnapshot({
      sessionId: 'session-test',
      turnId: 'turn-test',
      cwd,
      phase: 'completed'
    })
    assert.equal(completed.status, 'captured')

    if (baseline.status !== 'captured' || completed.status !== 'captured') {
      assert.fail('Expected checkpoint captures to succeed.')
    }

    const diff = service.diffSnapshots(baseline.commit, completed.commit)
    assert.ok(diff?.includes('diff --git a/src/sample.txt b/src/sample.txt'))
    assert.ok(diff?.includes('diff --git a/src/new.txt b/src/new.txt'))

    const targetRefs = git(cwd, ['for-each-ref', '--format=%(refname)', 'refs/open-science'])
    assert.equal(targetRefs, '')
    const checkpointRefs = git(checkpointGitDir, ['for-each-ref', '--format=%(refname)', 'refs/open-science'])
    assert.ok(checkpointRefs.includes('refs/open-science/checkpoints/session-test/turn-test/baseline'))
    assert.ok(checkpointRefs.includes('refs/open-science/checkpoints/session-test/turn-test/completed'))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
    rmSync(checkpointGitDir, { recursive: true, force: true })
  }
})
