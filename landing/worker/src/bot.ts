/**
 * Заявки и бот Telegram.
 *
 * Клиент записывается на сайте или прямо в боте (пакет → день → время → имя → пожелания → согласие).
 * Фотограф получает заявку с кнопками «Подтвердить» и «Отменить», клиенту приходит ответ.
 * Фотограф узнаётся по username (OWNER_USERNAME): его chat id запоминается при первом сообщении боту.
 */
import {
  LIMITS,
  addDays,
  PACKAGES,
  SLOT_TIMES,
  bookingWindow,
  formatPrice,
  isBookableDate,
  packageSummary,
  todayInTz,
  validateBooking,
  type BookingRequest,
} from '../../shared/booking'
import { SlotTaken, type Store } from './store'
import {
  OWNER_TELEGRAM,
  STATUS_RU,
  clientMessage,
  contactsMessage,
  escape,
  formatDateShort,
  longDate,
  ownerMessage,
  portfolioPhotos,
  priceMessage,
  type Booking,
  type Status,
} from './texts'
import { sha256, type Keyboard, type TelegramApi } from './tg'

const MAX_BOOKINGS_PER_HOUR = 5
const DAYS_PER_PAGE = 8

export class BookingError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export type SlotsData = { first: string; last: string; times: string[]; slots: Record<string, string[]> }

/** Шаги записи в боте — хранятся в базе между сообщениями. */
type ChatState = { step?: 'name' | 'comment' | 'confirm'; pkg?: string; date?: string; time?: string; name?: string; comment?: string }

type User = { id?: number; first_name?: string; last_name?: string; username?: string }
type Message = { message_id?: number; chat?: { id: number; type: string }; from?: User; text?: string }
type CallbackQuery = { id: string; data?: string; from?: User; message?: Message }
export type Update = { message?: Message; callback_query?: CallbackQuery }

const btn = (text: string, data: string) => ({ text, callback_data: data })
const urlBtn = (text: string, url: string) => ({ text, url })

const MENU: Keyboard = [
  [btn('📅 Записаться', 'bk')],
  [btn('💰 Прайс', 'price'), btn('📷 Портфолио', 'pf')],
  [btn('🗓 Мои записи', 'my'), btn('✉️ Контакты', 'ct')],
]
const BACK_TO_MENU: Keyboard = [[btn('← В меню', 'm')]]

const OWNER_HELP = [
  'Команды фотографа:',
  '/bookings — ближайшие записи',
  '/close 7.11 — закрыть день для записи',
  '/open 7.11 — открыть день снова',
  '/closed — закрытые дни',
].join('\n')

const fullName = (u: User) => [u.first_name, u.last_name].filter(Boolean).join(' ').slice(0, LIMITS.name)
const today = () => todayInTz()

/** «5.11», «05.11.2026» или «2026-11-05» → «2026-11-05». Без года — ближайшая такая дата. */
export function parseDay(text: string, now = new Date()): string | null {
  const t = text.trim()
  const valid = (y: number, m: number, d: number) => {
    const dt = new Date(Date.UTC(y, m - 1, d))
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null
  }
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return valid(+m[1], +m[2], +m[3])
  m = t.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/)
  if (!m) return null
  const todayStr = todayInTz(now)
  let year = m[3] ? +m[3] : +todayStr.slice(0, 4)
  if (year < 100) year += 2000
  let day = valid(year, +m[2], +m[1])
  if (day && !m[3] && day < todayStr) day = valid(year + 1, +m[2], +m[1])
  return day
}

export class Bot {
  readonly ownerUsername: string

  constructor(
    public store: Store,
    public tg: TelegramApi,
    public username: string | null,
    ownerUsername: string,
    public site: string,
  ) {
    this.ownerUsername = ownerUsername.replace(/^@/, '').toLowerCase()
  }

  /* ================= Заявки (общие для сайта и бота) ================= */

  async freeSlots(): Promise<SlotsData> {
    const { first, last } = bookingWindow()
    const [taken, closed] = await Promise.all([this.store.taken(first), this.store.closedDays()])
    const slots: Record<string, string[]> = {}
    for (let d = first; d <= last; d = addDays(d, 1)) {
      if (isBookableDate(d) && !closed.has(d)) slots[d] = SLOT_TIMES.filter((t) => !taken.has(`${d} ${t}`))
    }
    return { first, last, times: SLOT_TIMES, slots }
  }

  private async rateLimit(key: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    const recent = (await this.store.getJson<number[]>(key, [])).filter((t) => t > now - 3600)
    if (recent.length >= MAX_BOOKINGS_PER_HOUR) throw new BookingError(429, 'Слишком много заявок подряд. Напишите мне в Telegram.')
    await this.store.putJson(key, [...recent, now])
  }

  async createBooking(data: Partial<BookingRequest>, source: Booking['source'], opts: { clientChat?: number; ip?: string } = {}): Promise<Booking> {
    const problem = validateBooking(data)
    if (problem) throw new BookingError(400, problem)
    if ((await this.store.closedDays()).has(data.date!)) throw new BookingError(400, 'На эту дату запись недоступна.')
    const ipHash = opts.ip ? await sha256(opts.ip) : null
    await this.rateLimit(ipHash ? `rl:${ipHash}` : `rl:chat${opts.clientChat}`)
    const pkg = PACKAGES.find((p) => p.id === data.packageId)!
    const b: Booking = {
      token: randomToken(),
      created: Math.floor(Date.now() / 1000),
      package_id: pkg.id,
      package_name: pkg.name,
      package_price: pkg.price,
      date: data.date!,
      time: data.time!,
      name: data.name!.trim(),
      contact: data.contact!.trim(),
      comment: (data.comment ?? '').trim(),
      status: 'new',
      source,
      client_chat: opts.clientChat ?? null,
      owner_msg: null,
      ip_hash: ipHash,
    }
    try {
      await this.store.createBooking(b)
    } catch (err) {
      if (err instanceof SlotTaken) throw new BookingError(409, 'Это время только что заняли. Выберите другое.')
      throw err
    }
    await this.notifyOwner(b)
    return b
  }

  ownerButtons(b: Booking): Keyboard {
    const rows: Keyboard = []
    if (b.status === 'new') rows.push([btn('✅ Подтвердить', `c:${b.token}`), btn('✖️ Отменить', `x:${b.token}`)])
    else if (b.status === 'confirmed') rows.push([btn('✖️ Отменить', `x:${b.token}`)])
    if (/^@\w{3,}$/.test(b.contact)) rows.push([urlBtn('💬 Написать клиенту', `https://t.me/${b.contact.slice(1)}`)])
    return rows
  }

  /** Сообщение фотографу. false — пока некуда (фотограф ещё не писал боту) или Telegram недоступен. */
  async notifyOwner(b: Booking): Promise<boolean> {
    const owner = await this.store.ownerChat()
    if (owner === null) return false
    const msgId = await this.tg.send(owner, ownerMessage(b), this.ownerButtons(b))
    if (msgId === null) return false
    await this.store.updateBooking(b.token, { owner_msg: msgId })
    b.owner_msg = msgId
    return true
  }

  /** Заявки, о которых фотограф ещё не знает. */
  async notifyPending(): Promise<void> {
    for (const b of await this.store.bookingsFrom(today())) {
      if (b.status === 'new' && !b.owner_msg && !(await this.notifyOwner(b))) break
    }
  }

  async refreshOwnerMessage(b: Booking): Promise<void> {
    const owner = await this.store.ownerChat()
    if (owner !== null && b.owner_msg) await this.tg.edit(owner, b.owner_msg, ownerMessage(b), this.ownerButtons(b))
  }

  async setStatus(token: string, status: Status, byClient = false): Promise<Booking | null> {
    const b = await this.store.getBooking(token)
    if (!b) return null
    if (b.status === status) return b
    if (b.status === 'cancelled') throw new BookingError(409, 'Заявка уже отменена.')
    if (status === 'cancelled') await this.store.cancelBooking(token)
    else await this.store.updateBooking(token, { status })
    b.status = status
    await this.refreshOwnerMessage(b)
    if (byClient) {
      const owner = await this.store.ownerChat()
      if (owner !== null)
        await this.tg.send(owner, `Клиент отменил запись: ${escape(b.name)}, ${longDate(b.date, false)}, ${b.time}. Окошко снова свободно.`)
    } else if (b.client_chat) {
      await this.tg.send(b.client_chat, clientMessage(b), this.clientButtons(b))
    }
    return b
  }

  clientButtons(b: Booking): Keyboard {
    if (b.status === 'cancelled') return [[btn('📅 Записаться снова', 'bk')]]
    return [[btn('Отменить запись', `cx:${b.token}`)], [btn('← В меню', 'm')]]
  }

  async statusForSite(token: string) {
    const b = await this.store.getBooking(token)
    if (!b) return null
    return {
      status: b.status,
      packageName: b.package_name,
      packagePrice: b.package_price,
      date: b.date,
      time: b.time,
      name: b.name,
      subscribed: b.client_chat !== null,
      telegramBot: this.username,
    }
  }

  /* ================= Telegram ================= */

  async handleUpdate(upd: Update): Promise<void> {
    if (upd.callback_query) await this.onCallback(upd.callback_query)
    else if (upd.message) {
      this.incoming = null
      try {
        await this.onMessage(upd.message)
      } finally {
        // Команду клиента убираем уже после ответа — так чат не пустеет и не прыгает
        const incoming = this.incoming as { chat: number; id: number } | null // присваивается в onMessage
        if (incoming) {
          await this.deleteMessages(incoming.chat, [incoming.id])
          await this.store.putJson(`uitop:${incoming.chat}`, Math.max(await this.screenTop(incoming.chat), incoming.id))
        }
      }
    }
  }

  async isOwner(chatId: number): Promise<boolean> {
    return chatId === (await this.store.ownerChat())
  }

  private async rememberOwner(msg: Message): Promise<void> {
    const chat = msg.chat!
    if ((msg.from?.username ?? '').toLowerCase() !== this.ownerUsername) return
    if ((await this.store.ownerChat()) === chat.id) return
    await this.store.put('owner', String(chat.id))
    await this.tg.send(chat.id, 'Готово: вы — фотограф. Новые заявки будут приходить сюда.')
    await this.notifyPending()
  }

  private state(chatId: number) {
    return this.store.getJson<ChatState>(`chat:${chatId}`, {})
  }

  private setState(chatId: number, st: ChatState | null) {
    return this.store.putJson(`chat:${chatId}`, st)
  }

  /*
   * «Окно» бота: сообщения текущего экрана (меню, прайс, альбом портфолио, шаги записи) хранятся в kv `ui:<чат>`.
   * Переход по кнопке меняет окно на месте и удаляет лишнее (например, альбом), команда — убирает окно и рисует
   * его заново внизу. Так переписка не растёт. Остаются только важные сообщения: заявки, ответы о статусе.
   */

  /** Нажатое сообщение с кнопками (при нажатии кнопки) или null. */
  private pressed: number | null = null
  /** Окно стоит прямо над сообщением клиента — после удаления сообщения его можно обновить на месте. */
  private inPlace = false
  /** Сообщение клиента (команда или ответ на шаг записи), которое уберём после ответа. */
  private incoming: { chat: number; id: number } | null = null

  private screen(chatId: number) {
    return this.store.getJson<number[]>(`ui:${chatId}`, [])
  }

  private setScreen(chatId: number, ids: number[]) {
    return this.store.putJson(`ui:${chatId}`, ids.length ? ids : null)
  }

  /** Последнее сообщение внизу чата, которое наше: окно или уже удалённое сообщение клиента. */
  private async screenTop(chatId: number): Promise<number> {
    return Math.max((await this.screen(chatId)).at(-1) ?? 0, await this.store.getJson<number>(`uitop:${chatId}`, 0))
  }

  private async deleteMessages(chatId: number, ids: number[]): Promise<void> {
    // Сообщения старше 48 часов Telegram удалить не даст — просто останутся
    if (ids.length) await this.tg.call('deleteMessages', { chat_id: chatId, message_ids: ids })
  }

  /**
   * Показать экран. keep — сообщение остаётся в переписке (подтверждение записи), следующий экран появится ниже.
   */
  private async show(chatId: number, text: string, buttons: Keyboard, opts: { keep?: boolean } = {}): Promise<void> {
    const old = await this.screen(chatId)
    const main = this.pressed !== null && old.includes(this.pressed) ? this.pressed : this.inPlace ? old.at(-1) : undefined
    if (main !== undefined && (await this.tg.edit(chatId, main, text, buttons))) {
      await this.deleteMessages(chatId, old.filter((id) => id !== main))
      await this.setScreen(chatId, opts.keep ? [] : [main])
      return
    }
    // Сначала новое сообщение, потом удаляем старое — чат ни на миг не остаётся пустым
    const id = await this.tg.send(chatId, text, buttons)
    await this.deleteMessages(chatId, old)
    await this.setScreen(chatId, opts.keep || id === null ? [] : [id])
  }

  /* ---------- сообщения ---------- */

  async onMessage(msg: Message): Promise<void> {
    const chatId = msg.chat?.id
    if (chatId === undefined || msg.chat?.type !== 'private') return
    await this.rememberOwner(msg)
    this.pressed = null
    this.inPlace = false
    const text = (msg.text ?? '').trim()
    const st = await this.state(chatId)
    // Команды и ответы на шаги записи убираем из переписки; обычный текст оставляем — вдруг это вопрос
    if (msg.message_id && (text.startsWith('/') || st.step === 'name' || st.step === 'comment')) {
      this.incoming = { chat: chatId, id: msg.message_id }
      // id сообщений в личном чате идут подряд: окно прямо над командой — значит, оно внизу чата
      // (удалённые нами сообщения клиента номера тоже занимали)
      this.inPlace = (await this.screen(chatId)).length > 0 && (await this.screenTop(chatId)) === msg.message_id - 1
    }
    const [rawCmd, ...rest] = text.split(/\s+/)
    const cmd = rawCmd.split('@')[0].toLowerCase()
    const arg = rest.join(' ')

    if (cmd === '/start' && arg.startsWith('b_')) return this.subscribe(chatId, arg.slice(2))
    if (cmd === '/book' || (cmd === '/start' && arg === 'book')) return this.askPackage(chatId)
    if (cmd === '/start' || cmd === '/menu') {
      await this.setState(chatId, null)
      return this.menu(chatId, true)
    }
    if (cmd === '/price') return this.sendPrice(chatId)
    if (cmd === '/portfolio') return this.sendPortfolio(chatId)
    if (cmd === '/contacts') return this.show(chatId, contactsMessage(this.site), BACK_TO_MENU)
    if (cmd === '/my') return this.myBookings(chatId)
    if (cmd === '/cancel') {
      await this.setState(chatId, null)
      return this.menu(chatId)
    }
    if (cmd in OWNER_COMMANDS && (await this.isOwner(chatId))) return OWNER_COMMANDS[cmd](this, chatId, arg)

    if (text && !text.startsWith('/')) {
      if (st.step === 'name') {
        if (text.length > LIMITS.name) return this.askName(chatId, st, msg.from ?? {}, 'Имя слишком длинное — напишите покороче.')
        return this.askComment(chatId, { ...st, name: text })
      }
      if (st.step === 'comment') {
        if (text.length > LIMITS.comment)
          return this.askComment(chatId, st, `Комментарий длиннее ${LIMITS.comment} символов — сократите, пожалуйста.`)
        return this.askConfirm(chatId, { ...st, comment: text })
      }
    }
    await this.show(chatId, `Я бот для записи на съёмку. Написать мне лично: @${OWNER_TELEGRAM}`, MENU)
  }

  async menu(chatId: number, greeting = false): Promise<void> {
    let text = greeting
      ? 'Привет! Я Вааг, портретный фотограф в Санкт-Петербурге.\n\nЗдесь можно записаться на съёмку, посмотреть прайс и портфолио.'
      : 'Что дальше?'
    if (greeting && (await this.isOwner(chatId))) text += `\n\n${OWNER_HELP}`
    await this.show(chatId, text, MENU)
  }

  async sendPrice(chatId: number): Promise<void> {
    await this.show(chatId, priceMessage(this.site), [[btn('📅 Записаться', 'bk')], [btn('← В меню', 'm')]])
  }

  async sendPortfolio(chatId: number): Promise<void> {
    // Альбом нельзя вставить в старое сообщение — рисуем альбом с кнопками внизу, потом убираем старое окно
    const old = await this.screen(chatId)
    const ids: number[] = []
    const photos = portfolioPhotos(this.site)
    if (photos.length) {
      const media = photos.map((p, i) => ({ type: 'photo', media: p.url, ...(i === 0 ? { caption: `Серия «${p.series}»` } : {}) }))
      const sent = (await this.tg.call('sendMediaGroup', { chat_id: chatId, media })) as { message_id: number }[] | null
      ids.push(...(sent ?? []).map((m) => m.message_id))
    }
    const id = await this.tg.send(chatId, '📷 Всё портфолио — на сайте.', [
      [urlBtn('Открыть портфолио', `${this.site}/#portfolio`)],
      [btn('📅 Записаться', 'bk')],
      [btn('← В меню', 'm')],
    ])
    if (id !== null) ids.push(id)
    await this.deleteMessages(chatId, old)
    await this.setScreen(chatId, ids)
  }

  async subscribe(chatId: number, token: string): Promise<void> {
    const b = await this.store.getBooking(token.trim())
    if (!b) return this.show(chatId, 'Не нашёл такую заявку. Попробуйте открыть ссылку с сайта ещё раз.', MENU)
    await this.store.updateBooking(b.token, { client_chat: chatId })
    b.client_chat = chatId
    await this.refreshOwnerMessage(b)
    await this.show(chatId, `${clientMessage(b)}\n\n🔔 Пришлю сюда, когда статус изменится.`, this.clientButtons(b), { keep: true })
  }

  async myBookings(chatId: number): Promise<void> {
    const mine = (await this.store.bookingsFrom(today())).filter((b) => b.client_chat === chatId && b.status !== 'cancelled')
    if (!mine.length) return this.show(chatId, 'У вас пока нет записей.', [[btn('📅 Записаться', 'bk')], [btn('← В меню', 'm')]])
    const lines = ['🗓 <b>Ваши записи</b>', '']
    const rows: Keyboard = []
    for (const b of mine) {
      lines.push(`${longDate(b.date, false)}, ${b.time} — ${escape(b.package_name)}, ${STATUS_RU[b.status]}`)
      rows.push([btn(`Отменить ${formatDateShort(b.date)}, ${b.time}`, `cx:${b.token}`)])
    }
    await this.show(chatId, lines.join('\n'), [...rows, [btn('← В меню', 'm')]])
  }

  /* ---------- запись в боте ---------- */

  async askPackage(chatId: number): Promise<void> {
    const rows = PACKAGES.map((p) => [btn(`${p.name} · ${packageSummary(p)} · ${formatPrice(p.price)}`, `p:${p.id}`)])
    await this.show(chatId, '📅 <b>Запись на съёмку</b>\n\nВыберите пакет:', [...rows, ...BACK_TO_MENU])
  }

  async askDate(chatId: number, pkgId: string, page = 0): Promise<void> {
    const pkg = PACKAGES.find((p) => p.id === pkgId)
    if (!pkg) return this.askPackage(chatId)
    const days = Object.entries((await this.freeSlots()).slots)
      .filter(([, times]) => times.length)
      .map(([d]) => d)
      .sort()
    if (!days.length) return this.show(chatId, `Свободных окошек сейчас нет. Напишите мне: @${OWNER_TELEGRAM}`, BACK_TO_MENU)
    page = Math.max(0, Math.min(page, Math.floor((days.length - 1) / DAYS_PER_PAGE)))
    const chunk = days.slice(page * DAYS_PER_PAGE, (page + 1) * DAYS_PER_PAGE)
    const rows: Keyboard = []
    for (let i = 0; i < chunk.length; i += 2) rows.push(chunk.slice(i, i + 2).map((d) => btn(formatDateShort(d), `d:${pkgId}:${d}`)))
    const nav = []
    if (page > 0) nav.push(btn('← Раньше', `p:${pkgId}:${page - 1}`))
    if ((page + 1) * DAYS_PER_PAGE < days.length) nav.push(btn('Позже →', `p:${pkgId}:${page + 1}`))
    if (nav.length) rows.push(nav)
    rows.push([btn('← Пакеты', 'bk')])
    await this.show(chatId, `<b>${escape(pkg.name)}</b> · ${formatPrice(pkg.price)}\n\nВыберите день:`, rows)
  }

  async askTime(chatId: number, pkgId: string, day: string): Promise<void> {
    const times = (await this.freeSlots()).slots[day] ?? []
    if (!times.length) return this.show(chatId, 'Этот день уже заняли — выберите другой.', [[btn('← К датам', `p:${pkgId}`)]])
    const rows: Keyboard = []
    for (let i = 0; i < times.length; i += 4) rows.push(times.slice(i, i + 4).map((t) => btn(t, `t:${pkgId}:${day}:${t}`)))
    rows.push([btn('← К датам', `p:${pkgId}`)])
    const title = longDate(day, false)
    await this.show(chatId, `${title[0].toUpperCase()}${title.slice(1)}\n\nВыберите время:`, rows)
  }

  async askName(chatId: number, st: ChatState, user: User, problem?: string): Promise<void> {
    await this.setState(chatId, { ...st, step: 'name' })
    const rows: Keyboard = []
    const name = fullName(user)
    if (name) rows.push([btn(name, 'n')])
    rows.push([btn('← К времени', `d:${st.pkg}:${st.date}`)])
    await this.show(chatId, `${problem ? `${problem}\n\n` : ''}Как к вам обращаться? Напишите имя или нажмите кнопку.`, rows)
  }

  async askComment(chatId: number, st: ChatState, problem?: string): Promise<void> {
    await this.setState(chatId, { ...st, step: 'comment' })
    await this.show(
      chatId,
      `${problem ? `${problem}\n\n` : ''}Есть пожелания к съёмке — место, образ, идея? Напишите одним сообщением или нажмите «Без комментария».`,
      [[btn('Без комментария', 'nc')]],
    )
  }

  async askConfirm(chatId: number, st: ChatState): Promise<void> {
    await this.setState(chatId, { ...st, step: 'confirm' })
    const pkg = PACKAGES.find((p) => p.id === st.pkg)!
    const lines = [
      '<b>Проверьте заявку</b>',
      '',
      `Пакет: ${escape(pkg.name)} — ${formatPrice(pkg.price)}`,
      `Дата: ${longDate(st.date!, false)}`,
      `Время: ${st.time}`,
      `Имя: ${escape(st.name!)}`,
    ]
    if (st.comment) lines.push(`Комментарий: ${escape(st.comment)}`)
    lines.push(
      '',
      `Нажимая «Записаться», вы соглашаетесь на <a href="${this.site}/#privacy">обработку персональных данных</a>: ` +
        'имя, контакт в Telegram и детали съёмки придут мне.',
    )
    await this.show(chatId, lines.join('\n'), [[btn('✅ Записаться', 'ok')], [btn('Изменить время', `p:${st.pkg}`), btn('Отмена', 'm')]])
  }

  async finishBooking(chatId: number, user: User): Promise<void> {
    const st = await this.state(chatId)
    if (st.step !== 'confirm') return this.askPackage(chatId)
    const data: BookingRequest = {
      packageId: st.pkg!,
      date: st.date!,
      time: st.time!,
      name: st.name!,
      contact: user.username ? `@${user.username}` : `Telegram, id ${chatId}`,
      comment: st.comment ?? '',
      consent: true,
    }
    let b: Booking
    try {
      b = await this.createBooking(data, 'bot', { clientChat: chatId })
    } catch (err) {
      if (!(err instanceof BookingError)) throw err
      const rows = err.status === 409 ? [[btn('Выбрать другое время', `p:${st.pkg}`)]] : BACK_TO_MENU
      return this.show(chatId, err.message, rows)
    }
    await this.setState(chatId, null)
    // Подтверждение записи остаётся в переписке
    await this.show(chatId, clientMessage(b), this.clientButtons(b), { keep: true })
  }

  /* ---------- кнопки ---------- */

  async onCallback(cq: CallbackQuery): Promise<void> {
    const chatId = cq.message?.chat?.id
    const msgId = cq.message?.message_id
    const user = cq.from ?? {}
    const data = cq.data ?? ''
    const i = data.indexOf(':')
    const action = i < 0 ? data : data.slice(0, i)
    const rest = i < 0 ? '' : data.slice(i + 1)
    let notice: string | null = null
    if (chatId === undefined) return this.tg.answer(cq.id)
    this.pressed = msgId ?? null
    this.inPlace = false

    switch (action) {
      case 'c':
      case 'x':
        notice = await this.ownerAction(chatId, action, rest)
        break
      case 'm':
        await this.setState(chatId, null)
        await this.menu(chatId, false)
        break
      case 'bk':
        await this.askPackage(chatId)
        break
      case 'price':
        await this.sendPrice(chatId)
        break
      case 'pf':
        await this.sendPortfolio(chatId)
        break
      case 'ct':
        await this.show(chatId, contactsMessage(this.site), BACK_TO_MENU)
        break
      case 'my':
        await this.myBookings(chatId)
        break
      case 'p': {
        const [pkgId, page] = rest.split(':')
        await this.askDate(chatId, pkgId, Number(page) || 0)
        break
      }
      case 'd': {
        const [pkgId, day] = rest.split(':')
        await this.askTime(chatId, pkgId, day)
        break
      }
      case 't': {
        const [pkgId, day, hh, mm] = rest.split(':')
        const time = `${hh}:${mm}`
        if (!((await this.freeSlots()).slots[day] ?? []).includes(time)) {
          notice = 'Это время уже заняли'
          await this.askTime(chatId, pkgId, day)
        } else {
          await this.askName(chatId, { pkg: pkgId, date: day, time }, user)
        }
        break
      }
      case 'n': {
        const st = await this.state(chatId)
        if (st.step === 'name') await this.askComment(chatId, { ...st, name: fullName(user) })
        break
      }
      case 'nc': {
        const st = await this.state(chatId)
        if (st.step === 'comment') await this.askConfirm(chatId, { ...st, comment: '' })
        break
      }
      case 'ok':
        await this.finishBooking(chatId, user)
        break
      case 'cx':
      case 'cy': {
        const b = await this.store.getBooking(rest)
        if (!b || b.client_chat !== chatId || b.status === 'cancelled') break
        if (action === 'cx') {
          await this.show(chatId, `Отменить запись на ${longDate(b.date, false)}, ${b.time}?`, [[btn('Да, отменить', `cy:${rest}`), btn('Нет', 'my')]])
        } else {
          const done = (await this.setStatus(rest, 'cancelled', true))!
          await this.show(chatId, clientMessage(done), this.clientButtons(done), { keep: true })
          notice = 'Запись отменена'
        }
        break
      }
    }
    await this.tg.answer(cq.id, notice)
  }

  async ownerAction(chatId: number, action: string, token: string): Promise<string> {
    if (!(await this.isOwner(chatId))) return 'Эти кнопки только для фотографа.'
    const status: Status = action === 'c' ? 'confirmed' : 'cancelled'
    let b: Booking | null
    try {
      b = await this.setStatus(token, status)
    } catch (err) {
      if (err instanceof BookingError) return err.message
      throw err
    }
    if (!b) return 'Заявка не найдена'
    return `Заявка ${STATUS_RU[status]}${b.client_chat ? ', клиенту отправлен ответ' : ''}`
  }
}

/* ================= Команды фотографа ================= */

async function cmdBookings(bot: Bot, chatId: number): Promise<void> {
  const items = (await bot.store.bookingsFrom(today())).filter((b) => b.status !== 'cancelled')
  if (!items.length) return void (await bot.tg.send(chatId, 'Ближайших записей нет.'))
  const lines = ['🗓 <b>Ближайшие записи</b>', '']
  for (const b of items.slice(0, 30)) {
    const mark = b.status === 'confirmed' ? '✅' : '🆕'
    lines.push(`${mark} ${formatDateShort(b.date)}, ${b.time} — ${escape(b.name)}, ${escape(b.package_name)}, ${escape(b.contact)}`)
  }
  if (items.length > 30) lines.push(`…и ещё ${items.length - 30}`)
  await bot.tg.send(chatId, lines.join('\n'))
  await bot.notifyPending()
}

async function cmdClose(bot: Bot, chatId: number, arg: string, open = false): Promise<void> {
  const day = parseDay(arg)
  if (!day) return void (await bot.tg.send(chatId, `Напишите дату, например: /${open ? 'open' : 'close'} 7.11`))
  const days = await bot.store.closedDays()
  if (open) days.delete(day)
  else days.add(day)
  await bot.store.setClosedDays(new Set([...days].filter((d) => d >= today())))
  if (open) return void (await bot.tg.send(chatId, `День открыт для записи: ${longDate(day)}`))
  const busy = (await bot.store.bookingsFrom(day)).filter((b) => b.date === day && b.status !== 'cancelled')
  const note = busy.length ? `\n\nНа этот день уже есть записи (${busy.length}) — они остались. Посмотреть: /bookings` : ''
  await bot.tg.send(chatId, `День закрыт для записи: ${longDate(day)}${note}`)
}

async function cmdClosed(bot: Bot, chatId: number): Promise<void> {
  const days = [...(await bot.store.closedDays())].filter((d) => d >= today()).sort()
  if (!days.length) return void (await bot.tg.send(chatId, 'Закрытых дней нет. Закрыть: /close 7.11'))
  await bot.tg.send(chatId, `Закрыты для записи:\n${days.map((d) => longDate(d)).join('\n')}`)
}

const OWNER_COMMANDS: Record<string, (bot: Bot, chatId: number, arg: string) => Promise<void>> = {
  '/bookings': (bot, chatId) => cmdBookings(bot, chatId),
  '/close': (bot, chatId, arg) => cmdClose(bot, chatId, arg),
  '/open': (bot, chatId, arg) => cmdClose(bot, chatId, arg, true),
  '/closed': (bot, chatId) => cmdClosed(bot, chatId),
}

/* ================= Мелочи ================= */

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
