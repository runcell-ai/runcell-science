import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

// Env must be pinned before importing anything that reads config/env.ts.
const migrationDir = mkdtempSync(path.join(os.tmpdir(), 'open-science-migrate-test-'))
process.env.SQLITE_PATH = path.join(os.tmpdir(), `open-science-migrate-test-${process.pid}.sqlite`)
process.env.MIGRATION_DIR = migrationDir
process.env.LOG_LEVEL = 'silent'

const [{ runMigrations }, { closeDb, getDb }] = await Promise.all([
  import('../src/db/migrate'),
  import('../src/db/connection')
])

test.after(() => {
  closeDb()
  rmSync(process.env.SQLITE_PATH as string, { force: true })
  rmSync(migrationDir, { recursive: true, force: true })
})

test('a migration that violates foreign keys rolls back and is not recorded as applied', async () => {
  writeFileSync(
    path.join(migrationDir, '001_ok.sql'),
    `CREATE TABLE parents (id TEXT PRIMARY KEY);
     CREATE TABLE children (
       id TEXT PRIMARY KEY,
       parent_id TEXT NOT NULL REFERENCES parents(id) ON DELETE CASCADE
     );`
  )
  // Migrations run with foreign_keys OFF (table rebuilds need it), so this
  // orphan insert succeeds at exec time; only foreign_key_check catches it.
  writeFileSync(
    path.join(migrationDir, '002_bad.sql'),
    `INSERT INTO children (id, parent_id) VALUES ('c1', 'missing-parent');`
  )

  await assert.rejects(runMigrations(), /foreign key violation/)

  const db = getDb()
  const applied = db.prepare('SELECT name FROM _migrations ORDER BY name').all() as { name: string }[]
  assert.deepEqual(
    applied.map((row) => row.name),
    ['001_ok.sql'],
    'the failing migration must not be recorded as applied'
  )
  const children = db.prepare('SELECT count(*) AS count FROM children').get() as { count: number }
  assert.equal(children.count, 0, 'the failing migration must be rolled back')

  // The next startup retries the failed migration instead of skipping it.
  await assert.rejects(runMigrations(), /foreign key violation/)
})
