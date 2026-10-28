/** Тексты сообщений бота (HTML-разметка Telegram) и форматирование дат. */
import { PACKAGES, formatDateRu, formatPrice, packageSummary } from '../../shared/booking'
import seed from '../../server/app/seed.json'

export const OWNER_TELEGRAM = 'vaaaaaag'
const INSTAGRAM = 'vaag.ph'
const CHANNEL = 'Vaag_ph'

export const STATUS_RU = { new: 'новая', confirmed: 'подтверждена', cancelled: 'отменена' } as const
export type Status = keyof typeof STATUS_RU

const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

export type Booking = {
  token: string
  created: number
  package_id: string
  package_name: string
  package_price: number
  date: string
  time: string
  name: string
  contact: string
  comment: string
  status: Status
  source: 'site' | 'bot'
  client_chat: number | null
  owner_msg: number | null
  ip_hash: string | null
}

export const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** «сб, 7 ноября» — для кнопок. */
export function formatDateShort(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  return `${WEEKDAYS_SHORT[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS_RU[d.getUTCMonth()]}`
}

/** «суббота, 7 ноября 2026 г.» */
export const longDate = (date: string, withYear = true) => formatDateRu(date, withYear)

export function ownerMessage(b: Booking): string {
  let contact = escape(b.contact)
  // Ссылка открывает чат с клиентом, даже если у него нет @username
  if (b.client_chat) contact = `<a href="tg://user?id=${b.client_chat}">${contact}</a>`
  const lines = [
    `📸 <b>Заявка на съёмку</b> — ${STATUS_RU[b.status]}`,
    '',
    `Пакет: ${escape(b.package_name)} — ${formatPrice(b.package_price)}`,
    `Дата: ${longDate(b.date)}`,
    `Время: ${b.time}`,
    '',
    `Имя: ${escape(b.name)}`,
    `Связь: ${contact}`,
  ]
  if (b.comment) lines.push('', `Комментарий: ${escape(b.comment)}`)
  const source = b.source === 'bot' ? 'через бота' : 'с сайта'
  lines.push('', `<i>Заявка ${source}${b.client_chat ? ', клиент получит ответ в боте' : ''}</i>`)
  return lines.join('\n')
}

export function clientMessage(b: Booking): string {
  const when = `${longDate(b.date, false)}, ${b.time}`
  let head: string
  let tail: string
  if (b.status === 'confirmed') {
    head = '✅ <b>Съёмка подтверждена</b>'
    tail = `До встречи! Если планы изменятся — напишите мне: @${OWNER_TELEGRAM}`
  } else if (b.status === 'cancelled') {
    head = '<b>Заявка отменена</b>'
    tail = `Если это ошибка или хотите выбрать другое время — напишите мне (@${OWNER_TELEGRAM}) или запишитесь снова: /book`
  } else {
    head = '<b>Заявка получена</b>'
    tail = 'Я посмотрю её и подтвержу съёмку — сообщение придёт сюда.'
  }
  return `${head}\n\n${escape(b.package_name)} · ${when}\n\n${tail}`
}

export function priceMessage(site: string): string {
  const lines = ['💰 <b>Прайс</b>', '']
  for (const p of PACKAGES) {
    lines.push(`<b>${escape(p.name)}</b> — ${formatPrice(p.price)}`, escape(packageSummary(p)))
    for (const f of p.features) if (f !== `${p.duration} съёмки`) lines.push(`· ${escape(f)}`)
    lines.push('')
  }
  lines.push(`Свадьбы, события и скидки — <a href="${site}/#price">на сайте</a>.`)
  return lines.join('\n')
}

export function contactsMessage(site: string): string {
  return [
    '✉️ <b>Контакты</b>',
    '',
    `Telegram: @${OWNER_TELEGRAM}`,
    `Instagram: <a href="https://instagram.com/${INSTAGRAM}">@${INSTAGRAM}</a>`,
    `Канал: https://t.me/${CHANNEL}`,
    `Сайт: ${site}`,
  ].join('\n')
}

/** Фото для альбома в боте — не больше 10 (лимит Telegram). */
export function portfolioPhotos(site: string): { url: string; series: string }[] {
  return seed.series
    .flatMap((s) => s.photos.map((ph) => ({ url: `${site}/portfolio/${ph.file}.jpg`, series: s.title })))
    .slice(0, 10)
}
