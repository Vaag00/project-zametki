/** Минимальная замена D1 для тестов: тот же интерфейс поверх встроенного в Node SQLite. */
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

class Statement {
  params: unknown[] = []
  constructor(
    private db: DatabaseSync,
    readonly sql: string,
  ) {}
  bind(...params: unknown[]) {
    this.params = params.map((p) => (p === undefined ? null : p))
    return this
  }
  private stmt() {
    return this.db.prepare(this.sql)
  }
  async first<T>() {
    return (this.stmt().get(...(this.params as never[])) as T) ?? null
  }
  async all<T>() {
    return { results: this.stmt().all(...(this.params as never[])) as T[] }
  }
  async run() {
    this.runSync()
    return { success: true }
  }
  runSync() {
    this.stmt().run(...(this.params as never[]))
  }
}

export function memoryD1(): D1Database {
  const db = new DatabaseSync(':memory:')
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'))
  return {
    prepare: (sql: string) => new Statement(db, sql),
    async batch(stmts: Statement[]) {
      db.exec('BEGIN')
      try {
        for (const s of stmts) s.runSync()
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw new Error(`D1_ERROR: ${err}`)
      }
      return []
    },
  } as unknown as D1Database
}
