// Подключает бота к Worker: вебхук, меню команд, описание. Запускается при развёртывании.
// Переменные окружения: TELEGRAM_BOT_TOKEN, WORKER_URL.
import { createHash } from 'node:crypto'

const TOKEN = process.env.TELEGRAM_BOT_TOKEN
const URL = process.env.WORKER_URL
const API = process.env.TELEGRAM_API ?? 'https://api.telegram.org'
// Тот же секрет, что проверяет Worker (src/tg.ts → webhookSecret)
const secret = createHash('sha256').update(`vaag-webhook:${TOKEN}`).digest('hex').slice(0, 48)

async function call(method, params = {}) {
  const res = await fetch(`${API}/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await res.json()
  if (!data.ok) {
    console.error(`::error::Telegram ${method}: ${data.description}`)
    process.exit(1)
  }
  return data.result
}

await call('setWebhook', { url: `${URL}/?r=tg`, secret_token: secret, allowed_updates: ['message', 'callback_query'], max_connections: 10 })
await call('setMyCommands', {
  commands: [
    { command: 'book', description: 'Записаться на съёмку' },
    { command: 'price', description: 'Прайс' },
    { command: 'portfolio', description: 'Портфолио' },
    { command: 'my', description: 'Мои записи' },
    { command: 'contacts', description: 'Контакты' },
  ],
})
await call('setMyShortDescription', { short_description: 'Запись на съёмку к фотографу Ваагу, Санкт-Петербург' })
await call('setMyDescription', {
  description:
    'Портретный фотограф в Санкт-Петербурге.\n\nЗдесь можно выбрать пакет, свободный день и время и записаться на съёмку, ' +
    'посмотреть прайс и портфолио. Нажмите «Старт».',
})
const info = await call('getWebhookInfo')
console.log(`Вебхук: ${info.url}, ожидают обработки: ${info.pending_update_count ?? 0}`)
