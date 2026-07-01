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
      db.prepare(
        "INSERT INTO _migrations (name, applied_at, checksum) VALUES (?, datetime('now'), ?)"
      ).run(name, currentChecksum)
    })
    applyTransaction()
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
