import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

import { getDb } from './connection'
import { config } from '../config/env'

interface MigrationRow {
  name: string
  checksum: string
}

function readMigrationFiles(): string[] {
  if (!fs.existsSync(config.migrationDir)) {
    return []
  }

  return fs
    .readdirSync(config.migrationDir)
    .filter((name) => name.endsWith('.sql'))
    .sort((a: string, b: string) => a.localeCompare(b))
}

function checksumOf(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

export async function runMigrations(): Promise<void> {
  const db = getDb()

  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL,
      checksum TEXT NOT NULL
    );
  `)

  const statement = db.prepare('SELECT name, checksum FROM _migrations')
  const rows = statement.all() as MigrationRow[]
  const applied = new Map(rows.map((row) => [row.name, row.checksum]))

  const migrations = readMigrationFiles()

  for (const name of migrations) {
    const filePath = path.join(config.migrationDir, name)
    const sql = fs.readFileSync(filePath, 'utf8')
    const currentChecksum = checksumOf(sql)

    const appliedChecksum = applied.get(name)
    if (appliedChecksum) {
      if (appliedChecksum !== currentChecksum) {
        throw new Error(`Migration ${name} changed after apply; checksum mismatch.`)
      }
      continue
    }

    const applyTransaction = db.transaction(() => {
      db.exec(sql)
      // foreign_key_check is a read-only pragma, so it can (and must) run
      // inside the transaction: a violation has to roll back both the schema
      // change and the _migrations row, otherwise the failed migration would
      // be recorded as applied and skipped on the next startup.
      const violations = db.pragma('foreign_key_check') as unknown[]
      if (violations.length > 0) {
        throw new Error(`Migration ${name} left ${violations.length} foreign key violation(s).`)
      }
      db.prepare(
        "INSERT INTO _migrations (name, applied_at, checksum) VALUES (?, datetime('now'), ?)"
      ).run(name, currentChecksum)
    })
    // Table rebuilds (the standard SQLite way to change a CHECK constraint)
    // must not fire ON DELETE CASCADE when the old table is dropped. The
    // foreign_keys pragma is a no-op inside a transaction, so toggle it out
    // here.
    db.pragma('foreign_keys = OFF')
    try {
      applyTransaction()
    } finally {
      db.pragma('foreign_keys = ON')
    }
  }
}

const entryUrl = process.argv[1] ? `file://${path.resolve(process.cwd(), process.argv[1])}` : ''

if (entryUrl === import.meta.url) {
  runMigrations()
    .then(() => {
      console.info('Migrations completed.')
    })
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}
