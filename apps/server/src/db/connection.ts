import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

import { config } from '../config/env'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(path.dirname(config.sqlitePath), { recursive: true })
    db = new Database(config.sqlitePath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
  }

  return db
}

export function closeDb(): void {
  if (!db) {
    return
  }

  db.close()
  db = null
}
