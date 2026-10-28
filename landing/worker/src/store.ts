/** Хранилище заявок — Cloudflare D1 (SQLite). Таблицы — в schema.sql. */
import type { Booking } from './texts'

export class SlotTaken extends Error {}

const FIELDS = [
  'token', 'created', 'package_id', 'package_name', 'package_price', 'date', 'time', 'name', 'contact',
  'comment', 'status', 'source', 'client_chat', 'owner_msg', 'ip_hash',
] as const

export class Store {
  constructor(private db: D1Database) {}

  async get(key: string): Promise<string | null> {
    const row = await this.db.prepare('SELECT v FROM kv WHERE k = ?').bind(key).first<{ v: string }>()
    return row?.v ?? null
  }

  async put(key: string, value: string | null): Promise<void> {
    if (value === null) await this.db.prepare('DELETE FROM kv WHERE k = ?').bind(key).run()
    else await this.db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v').bind(key, value).run()
  }

  async getJson<T>(key: string, fallback: T): Promise<T> {
    const raw = await this.get(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  }

  putJson(key: string, value: unknown): Promise<void> {
    return this.put(key, value === null || value === undefined ? null : JSON.stringify(value))
  }

  async closedDays(): Promise<Set<string>> {
    return new Set(await this.getJson<string[]>('closed', []))
  }

  setClosedDays(days: Set<string>): Promise<void> {
    return this.putJson('closed', [...days].sort())
  }

  async ownerChat(): Promise<number | null> {
    const v = await this.get('owner')
    return v ? Number(v) : null
  }

  async createBooking(b: Booking): Promise<void> {
    const cols = FIELDS.join(', ')
    const marks = FIELDS.map(() => '?').join(', ')
    try {
      // batch в D1 — одна транзакция: окошко занимается вместе с заявкой или не занимается вовсе
      await this.db.batch([
        this.db.prepare('INSERT INTO slots (date, time, token) VALUES (?, ?, ?)').bind(b.date, b.time, b.token),
        this.db.prepare(`INSERT INTO bookings (${cols}) VALUES (${marks})`).bind(...FIELDS.map((f) => b[f])),
      ])
    } catch (err) {
      if (String(err).includes('UNIQUE')) throw new SlotTaken()
      throw err
    }
  }

  getBooking(token: string): Promise<Booking | null> {
    return this.db.prepare('SELECT * FROM bookings WHERE token = ?').bind(token).first<Booking>()
  }

  async updateBooking(token: string, fields: Partial<Pick<Booking, 'status' | 'client_chat' | 'owner_msg'>>): Promise<void> {
    const keys = Object.keys(fields) as (keyof typeof fields)[]
    const sets = keys.map((k) => `${k} = ?`).join(', ')
    await this.db.prepare(`UPDATE bookings SET ${sets} WHERE token = ?`).bind(...keys.map((k) => fields[k]), token).run()
  }

  async cancelBooking(token: string): Promise<void> {
    await this.db.batch([
      this.db.prepare("UPDATE bookings SET status = 'cancelled' WHERE token = ?").bind(token),
      this.db.prepare('DELETE FROM slots WHERE token = ?').bind(token),
    ])
  }

  /** Занятые окошки начиная с даты, в виде «2026-11-07 12:00». */
  async taken(firstDate: string): Promise<Set<string>> {
    const { results } = await this.db
      .prepare('SELECT date, time FROM slots WHERE date >= ?')
      .bind(firstDate)
      .all<{ date: string; time: string }>()
    return new Set(results.map((r) => `${r.date} ${r.time}`))
  }

  async bookingsFrom(firstDate: string): Promise<Booking[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM bookings WHERE date >= ? ORDER BY date, time')
      .bind(firstDate)
      .all<Booking>()
    return results
  }
}
