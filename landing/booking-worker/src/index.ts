/**
 * Сервер записи на съёмку (Cloudflare Worker + база D1).
 *
 *   GET  /slots    — свободные окошки на весь период записи
 *   POST /bookings — новая заявка: сохраняет и присылает фотографу сообщение в Telegram
 */
import {
  allSlots,
  bookingMessage,
  bookingWindow,
  validateBooking,
  type BookingRequest,
} from '../../shared/booking'

export interface Env {
  DB: D1Database
  ALLOWED_ORIGINS: string
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
  /** Только для локальной проверки: другой адрес Telegram API. */
  TELEGRAM_API?: string
}

/** Не больше стольких заявок с одного адреса за час — защита от спама. */
const MAX_BOOKINGS_PER_HOUR = 3

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    const { pathname } = new URL(request.url)
    try {
      if (request.method === 'GET' && pathname === '/slots') return json(await freeSlots(env), 200, cors)
      if (request.method === 'POST' && pathname === '/bookings') return await createBooking(request, env, cors)
      return json({ error: 'not_found' }, 404, cors)
    } catch (err) {
      console.error(err)
      return json({ error: 'server_error', message: 'Что-то пошло не так. Напишите мне в Telegram.' }, 500, cors)
    }
  },
}

async function freeSlots(env: Env) {
  const { first, last } = bookingWindow()
  const slots = allSlots(first, last)
  const { results } = await env.DB.prepare('SELECT date, time FROM bookings WHERE date BETWEEN ? AND ?')
    .bind(first, last)
    .all<{ date: string; time: string }>()
  for (const { date, time } of results) {
    if (slots[date]) slots[date] = slots[date].filter((t) => t !== time)
  }
  return { first, last, slots }
}

async function createBooking(request: Request, env: Env, cors: Headers): Promise<Response> {
  let body: Partial<BookingRequest>
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_request', message: 'Не удалось прочитать заявку.' }, 400, cors)
  }

  // Ловушка для ботов: делаем вид, что всё хорошо, но ничего не сохраняем
  if (body.website) return json({ ok: true }, 200, cors)

  const problem = validateBooking(body)
  if (problem) return json({ error: 'invalid', message: problem }, 400, cors)
  const b = body as BookingRequest

  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.error('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID не заданы')
    return json({ error: 'misconfigured', message: 'Онлайн-запись временно недоступна. Напишите мне в Telegram.' }, 503, cors)
  }

  const ipHash = await sha256(request.headers.get('CF-Connecting-IP') ?? 'unknown')
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM bookings WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')",
  )
    .bind(ipHash)
    .first<{ n: number }>()
  if ((recent?.n ?? 0) >= MAX_BOOKINGS_PER_HOUR) {
    return json({ error: 'too_many', message: 'Слишком много заявок подряд. Напишите мне в Telegram.' }, 429, cors)
  }

  let id: number
  try {
    const row = await env.DB.prepare(
      'INSERT INTO bookings (date, time, package_id, name, contact, comment, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
    )
      .bind(b.date, b.time, b.packageId, b.name.trim(), b.contact.trim(), b.comment.trim(), ipHash)
      .first<{ id: number }>()
    id = row!.id
  } catch (err) {
    if (String(err).includes('UNIQUE')) {
      return json({ error: 'slot_taken', message: 'Это время только что заняли. Выберите другое.' }, 409, cors)
    }
    throw err
  }

  // Без уведомления фотограф о заявке не узнает — тогда освобождаем окошко и сообщаем об ошибке
  const sent = await notifyTelegram(env, bookingMessage(b, id))
  if (!sent) {
    await env.DB.prepare('DELETE FROM bookings WHERE id = ?').bind(id).run()
    return json({ error: 'notify_failed', message: 'Не получилось отправить заявку. Напишите мне в Telegram.' }, 502, cors)
  }

  return json({ ok: true, id }, 201, cors)
}

async function notifyTelegram(env: Env, text: string): Promise<boolean> {
  const api = env.TELEGRAM_API ?? 'https://api.telegram.org'
  try {
    const res = await fetch(`${api}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
    })
    if (!res.ok) console.error('Telegram:', res.status, await res.text())
    return res.ok
  } catch (err) {
    console.error('Telegram недоступен:', err)
    return false
  }
}

function corsHeaders(request: Request, env: Env): Headers {
  const origin = request.headers.get('Origin') ?? ''
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
  const h = new Headers({ 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' })
  if (allowed.includes(origin)) h.set('Access-Control-Allow-Origin', origin)
  return h
}

function json(data: unknown, status: number, headers: Headers): Response {
  const h = new Headers(headers)
  h.set('Content-Type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(data), { status, headers: h })
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
