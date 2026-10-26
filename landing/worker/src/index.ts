/**
 * Cloudflare Worker: бот Telegram и запись на съёмку.
 *
 * Один адрес обслуживает и сайт, и Telegram. Маршрут — в параметре r (или в пути):
 *   ?r=content            GET  пакеты и имя бота
 *   ?r=slots              GET  свободные окошки
 *   ?r=bookings           POST новая заявка с сайта
 *   ?r=bookings/<token>   GET  статус заявки
 *   ?r=tg                 POST обновления от Telegram (вебхук)
 * Ответы — как у сервера на своём VPS (server/), так сайт работает с обоими.
 */
import { PACKAGES } from '../../shared/booking'
import { Bot, BookingError, type Update } from './bot'
import { Store } from './store'
import { Telegram, webhookSecret, type TelegramApi } from './tg'

export interface Env {
  DB: D1Database
  TELEGRAM_BOT_TOKEN: string
  BOT_USERNAME?: string
  OWNER_USERNAME?: string
  SITE_URL?: string
  /** Только для проверки без настоящего Telegram. */
  TELEGRAM_API?: string
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS } })
const error = (status: number, detail: string) => json(status, { detail })

export function makeBot(env: Env, tg?: TelegramApi): Bot {
  return new Bot(
    new Store(env.DB),
    tg ?? new Telegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_API),
    env.BOT_USERNAME || null,
    env.OWNER_USERNAME || 'vaaaaaag',
    (env.SITE_URL || 'https://vaag-ph.duckdns.org').replace(/\/$/, ''),
  )
}

export async function handle(request: Request, bot: Bot): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  const url = new URL(request.url)
  const route = (url.searchParams.get('r') ?? url.pathname).replace(/^\/+|\/+$/g, '').replace(/^api\//, '')
  const method = request.method

  try {
    if (route === 'tg' && method === 'POST') return await telegramWebhook(request, bot)
    if (route === 'content' && method === 'GET') return json(200, { packages: PACKAGES, telegramBot: bot.username })
    if (route === 'slots' && method === 'GET') return json(200, await bot.freeSlots())
    if (route === 'bookings' && method === 'POST') return await newBooking(request, bot)
    if (route.startsWith('bookings/') && method === 'GET') {
      const data = await bot.statusForSite(decodeURIComponent(route.slice('bookings/'.length)))
      return data ? json(200, data) : error(404, 'Заявка не найдена.')
    }
    if (route === '' && method === 'GET') return new Response('VAAAAAAG: бот работает', { headers: CORS })
    return error(404, 'Не найдено.')
  } catch (err) {
    console.error(`Ошибка при обработке ${method} ${route}:`, err)
    return error(500, 'Ошибка сервера. Напишите мне в Telegram.')
  }
}

async function newBooking(request: Request, bot: Bot): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return error(400, 'Пустая заявка.')
  // Ловушка для ботов: делаем вид, что всё хорошо, но ничего не сохраняем
  if (body.website) return json(201, { ok: true, token: null })
  try {
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
    const b = await bot.createBooking(body, 'site', { ip })
    return json(201, { ok: true, token: b.token })
  } catch (err) {
    if (err instanceof BookingError) return error(err.status, err.message)
    throw err
  }
}

async function telegramWebhook(request: Request, bot: Bot): Promise<Response> {
  if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== (await webhookSecret(bot.tg.token))) return error(403, 'Нет доступа.')
  const upd = (await request.json().catch(() => null)) as Update | null
  if (upd && typeof upd === 'object') {
    try {
      await bot.handleUpdate(upd)
    } catch (err) {
      // Отвечаем 200 в любом случае: иначе Telegram будет присылать то же обновление снова и снова
      console.error('Не удалось обработать обновление Telegram:', err)
    }
  }
  return json(200, { ok: true })
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, makeBot(env))
  },
} satisfies ExportedHandler<Env>
