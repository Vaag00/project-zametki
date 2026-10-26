/**
 * Настройки записи — общие для сайта и сервера (booking-worker), чтобы они не расходились.
 * Поменять расписание, пакеты или цены — только здесь, потом пересобрать сайт и выложить сервер.
 */

export type PackageId = 'minimal' | 'standard' | 'maximal'

export type Package = {
  id: PackageId
  name: string
  /** Длительность съёмки, например «2 часа». */
  duration: string
  /** Сколько фото в итоге; пусто — не указано. */
  photos?: string
  price: number
  /** Одна фраза под названием. */
  tagline?: string
  /** Что входит. */
  features: string[]
  /** Для кого пакет — мелкая подпись под ценой. */
  note?: string
}

/** Пакеты из прайса автора. Отсюда же берутся цены на главной, в записи и в сообщении в Telegram. */
export const PACKAGES: Package[] = [
  {
    id: 'minimal',
    name: 'Минимальный',
    duration: '1 час',
    price: 5000,
    features: ['1 час съёмки'],
  },
  {
    id: 'standard',
    name: 'Стандартный',
    duration: '2 часа',
    photos: '50 фото',
    price: 9000,
    tagline: 'Больше времени, чтобы расслабиться и найти свои кадры.',
    features: [
      '2 часа съёмки, несколько локаций',
      '50 обработанных фотографий',
      'Консультация, подбор мест, маршрут',
      'Авторская обработка, художественная ретушь',
      'Закрытый доступ к фото на облачном диске',
    ],
    note: 'Для атмосферных серий: лес, вода, город, настроение.',
  },
  {
    id: 'maximal',
    name: 'Максимальный',
    duration: '3 часа',
    photos: '75 фото + флешка',
    price: 15000,
    tagline: 'Полный формат: несколько мест, образов и много кадров.',
    features: [
      '3 часа съёмки, маршрут по локациям',
      '75 обработанных фотографий',
      'Консультация, подбор мест, маршрут',
      'Авторская обработка, художественная ретушь',
      'Закрытый доступ к фото на облачном диске',
      'Флешка со всеми обработанными фото',
    ],
    note: 'Для больших проектов и тех, кому важно получить всё.',
  },
]

/** «2 часа · 50 фото» */
export const packageSummary = (p: Package) => [p.duration, p.photos].filter(Boolean).join(' · ')

/** Часовой пояс съёмок: все даты и время на сайте — по Петербургу. */
export const TIMEZONE = 'Europe/Moscow'

/** Время начала съёмок. Одна заявка занимает одно окошко. */
export const SLOT_TIMES = ['09:00', '12:00', '15:00', '18:00']

/** Дни недели, когда идёт запись: 0 — воскресенье, 1 — понедельник … 6 — суббота. */
export const WORK_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]

/** Самая ранняя дата — через столько дней от сегодня (1 = с завтрашнего дня). */
export const MIN_LEAD_DAYS = 1

/** На сколько дней вперёд открыта запись. */
export const HORIZON_DAYS = 60

/* ---------- Даты как строки YYYY-MM-DD, без часовых сдвигов ---------- */

export function todayInTz(now = new Date()): string {
  // en-CA даёт формат YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(now)
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

/** Первая и последняя даты, на которые можно записаться. */
export function bookingWindow(now = new Date()) {
  const today = todayInTz(now)
  return { first: addDays(today, MIN_LEAD_DAYS), last: addDays(today, HORIZON_DAYS) }
}

export function isBookableDate(date: string, now = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const { first, last } = bookingWindow(now)
  return date >= first && date <= last && WORK_WEEKDAYS.includes(weekday(date))
}

/** Все окошки в диапазоне дат (без учёта занятых). */
export function allSlots(from: string, to: string, now = new Date()): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (isBookableDate(d, now)) out[d] = [...SLOT_TIMES]
  }
  return out
}

/** «пятница, 18 октября» */
export function formatDateRu(date: string, withYear = false): string {
  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`))
}

export const formatPrice = (n: number) => `${n.toLocaleString('ru-RU')} ₽`

/* ---------- Заявка ---------- */

export type BookingRequest = {
  packageId: PackageId
  date: string
  time: string
  name: string
  contact: string
  comment: string
  /** Поле-ловушка для ботов: человек его не видит и не заполняет. */
  website?: string
  /** Согласие на обработку персональных данных (152-ФЗ). Без него заявку не принимаем. */
  consent: boolean
}

export const LIMITS = { name: 80, contact: 100, comment: 1000 }

/** Проверка заявки. Возвращает текст ошибки для человека или null. */
export function validateBooking(b: Partial<BookingRequest>, now = new Date()): string | null {
  if (!b || typeof b !== 'object') return 'Пустая заявка.'
  if (!PACKAGES.some((p) => p.id === b.packageId)) return 'Выберите пакет.'
  if (typeof b.date !== 'string' || !isBookableDate(b.date, now)) return 'На эту дату запись недоступна.'
  if (typeof b.time !== 'string' || !SLOT_TIMES.includes(b.time)) return 'Выберите время.'
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  const contact = typeof b.contact === 'string' ? b.contact.trim() : ''
  const comment = typeof b.comment === 'string' ? b.comment.trim() : ''
  if (!name) return 'Напишите, как к вам обращаться.'
  if (name.length > LIMITS.name) return 'Имя слишком длинное.'
  if (contact.length < 3) return 'Оставьте Telegram или телефон, чтобы я мог ответить.'
  if (contact.length > LIMITS.contact) return 'Контакт слишком длинный.'
  if (b.consent !== true) return 'Отметьте согласие на обработку персональных данных.'
  if (comment.length > LIMITS.comment) return `Комментарий длиннее ${LIMITS.comment} символов.`
  return null
}

/** Текст заявки — его получает фотограф в Telegram (и его же видит клиент, если отправляет сам). */
export function bookingMessage(b: BookingRequest, id?: number): string {
  const pkg = PACKAGES.find((p) => p.id === b.packageId)!
  const lines = [
    `📸 Новая заявка на съёмку${id ? ` #${id}` : ''}`,
    '',
    `Пакет: ${pkg.name} (${packageSummary(pkg)}) — ${formatPrice(pkg.price)}`,
    `Дата: ${formatDateRu(b.date, true)}`,
    `Время: ${b.time}`,
    '',
    `Имя: ${b.name.trim()}`,
    `Связь: ${b.contact.trim()}`,
  ]
  if (b.comment.trim()) lines.push('', `Комментарий: ${b.comment.trim()}`)
  return lines.join('\n')
}
