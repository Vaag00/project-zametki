import { beforeEach, describe, expect, it } from 'vitest'
import { formatDateRu } from '../../shared/booking'
import { parseDay, type Bot } from '../src/bot'
import { handle, makeBot } from '../src/index'
import type { Booking } from '../src/texts'
import { webhookSecret, type Keyboard, type TelegramApi } from '../src/tg'
import { memoryD1 } from './d1'

const OWNER = 1000
const CLIENT = 2000

type Sent = { chat: number; text: string; buttons: Keyboard; id: number }

class FakeTelegram implements TelegramApi {
  token = '123:TEST'
  log: Sent[] = []
  calls: [string, unknown][] = []
  nextId = 1
  /** Сообщения, которые сейчас видны в чате (без удалённых). */
  visible = new Map<number, Set<number>>()
  async call(method: string, params: Record<string, unknown>) {
    this.calls.push([method, params])
    const chat = params.chat_id as number
    if (method === 'sendMediaGroup') {
      return (params.media as unknown[]).map(() => {
        this.see(chat, ++this.nextId)
        return { message_id: this.nextId }
      })
    }
    if (method === 'deleteMessages') for (const id of params.message_ids as number[]) this.visible.get(chat)?.delete(id)
    return true
  }
  see(chat: number, id: number) {
    if (!this.visible.has(chat)) this.visible.set(chat, new Set())
    this.visible.get(chat)!.add(id)
  }
  async send(chat: number, text: string, buttons: Keyboard = []) {
    this.log.push({ chat, text, buttons, id: ++this.nextId })
    this.see(chat, this.nextId)
    return this.nextId
  }
  async edit(chat: number, id: number, text: string, buttons: Keyboard = []) {
    if (!this.visible.get(chat)?.has(id)) return false
    this.log.push({ chat, text, buttons, id })
    return true
  }
  async answer(_id: string, text?: string | null) {
    this.calls.push(['answer', text ?? null])
  }
  /** Последнее, что увидел чат (новое сообщение или правка). */
  last(chat: number) {
    return this.log.filter((m) => m.chat === chat).at(-1)!
  }
}

const data = (m: Sent) => m.buttons.flat().map((b) => b.callback_data ?? '')

let bot: Bot
let tg: FakeTelegram

beforeEach(() => {
  tg = new FakeTelegram()
  bot = makeBot({ DB: memoryD1(), TELEGRAM_BOT_TOKEN: tg.token, BOT_USERNAME: 'vaag_test_bot' }, tg)
})

const message = (chat: number, text: string, username = 'client') => ({
  message: { chat: { id: chat, type: 'private' }, from: { id: chat, first_name: 'Аня', username }, text },
})
/** Нажатие кнопки на последнем сообщении чата (или на сообщении messageId). */
const press = (chat: number, d: string, username = 'client', messageId?: number) => ({
  callback_query: {
    id: 'cb',
    data: d,
    from: { id: chat, first_name: 'Аня', username },
    message: { message_id: messageId ?? tg.log.filter((m) => m.chat === chat).at(-1)?.id ?? 50, chat: { id: chat, type: 'private' } },
  },
})
const registerOwner = () => bot.handleUpdate(message(OWNER, '/start', 'Vaaaaaag'))

async function call(method: string, r: string, body?: unknown, headers: Record<string, string> = {}) {
  const req = new Request(`https://bot.test/?r=${r}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const res = await handle(req, bot)
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> }
}

async function firstFree() {
  const { slots } = await bot.freeSlots()
  const day = Object.keys(slots).sort().find((d) => slots[d].length)!
  return { day, time: slots[day][0] }
}

async function siteBooking(over: Record<string, unknown> = {}) {
  const { day, time } = await firstFree()
  return call('POST', 'bookings', { packageId: 'standard', date: day, time, name: 'Аня', contact: '@anya', comment: '', consent: true, ...over })
}

const allBookings = () => bot.store.bookingsFrom('')

describe('сайт', () => {
  it('отдаёт пакеты и свободные окошки', async () => {
    const content = await call('GET', 'content')
    expect(content.status).toBe(200)
    expect(content.body.telegramBot).toBe('vaag_test_bot')
    expect((content.body.packages as { id: string }[]).map((p) => p.id)).toEqual(['minimal', 'standard', 'maximal'])
    const slots = await call('GET', 'slots')
    expect(slots.body.times).toEqual(['09:00', '12:00', '15:00', '18:00'])
    expect(Object.keys(slots.body.slots as object).length).toBeGreaterThan(50)
  })

  it('заявка приходит фотографу и занимает окошко', async () => {
    await registerOwner()
    const res = await siteBooking()
    expect(res.status).toBe(201)
    const token = res.body.token as string
    const ownerMsg = tg.log.at(-1)!
    expect(ownerMsg.chat).toBe(OWNER)
    expect(ownerMsg.text).toContain('Заявка на съёмку')
    expect(data(ownerMsg)).toContain(`c:${token}`)

    const b = (await bot.store.getBooking(token))!
    const again = await call('POST', 'bookings', { packageId: 'standard', date: b.date, time: b.time, name: 'Б', contact: '@bob', consent: true })
    expect(again.status).toBe(409)
    expect((await bot.freeSlots()).slots[b.date]).not.toContain(b.time)

    const st = await call('GET', `bookings/${token}`)
    expect(st.body).toMatchObject({ status: 'new', subscribed: false, telegramBot: 'vaag_test_bot' })
  })

  it('проверяет согласие, ловушку для ботов и неизвестный код', async () => {
    const noConsent = await siteBooking({ consent: false })
    expect(noConsent.status).toBe(400)
    expect(noConsent.body.detail).toMatch(/согласие/)
    const spam = await siteBooking({ website: 'x' })
    expect(spam.status).toBe(201)
    expect(spam.body.token).toBeNull()
    expect(await allBookings()).toHaveLength(0)
    expect((await call('GET', 'bookings/nope')).status).toBe(404)
  })

  it('не больше 5 заявок в час с одного адреса', async () => {
    for (let i = 0; i < 5; i++) expect((await siteBooking()).status).toBe(201)
    expect((await siteBooking()).status).toBe(429)
  })

  it('фотограф, написавший боту позже, получает накопившиеся заявки', async () => {
    const res = await siteBooking()
    expect(tg.log).toHaveLength(0)
    await registerOwner()
    expect(tg.log.some((m) => m.chat === OWNER && data(m).includes(`c:${res.body.token}`))).toBe(true)
  })

  it('клиент подписался на уведомления, фотограф подтвердил и отменил', async () => {
    await registerOwner()
    const token = (await siteBooking()).body.token as string
    await bot.handleUpdate(message(CLIENT, `/start b_${token}`))
    expect(tg.last(CLIENT).text).toContain('Пришлю сюда')
    expect((await call('GET', `bookings/${token}`)).body.subscribed).toBe(true)

    await bot.handleUpdate(press(CLIENT, `c:${token}`))
    expect((await bot.store.getBooking(token))!.status).toBe('new')

    await bot.handleUpdate(press(OWNER, `c:${token}`, 'vaaaaaag'))
    expect((await bot.store.getBooking(token))!.status).toBe('confirmed')
    expect(tg.last(CLIENT).text).toContain('подтверждена')
    expect(tg.last(OWNER).text).toContain('подтверждена')

    await bot.handleUpdate(press(OWNER, `x:${token}`, 'vaaaaaag'))
    const b = (await bot.store.getBooking(token))!
    expect(b.status).toBe('cancelled')
    expect((await bot.freeSlots()).slots[b.date]).toContain(b.time)
    expect(tg.last(CLIENT).text).toContain('отменена')
  })
})

describe('запись в боте', () => {
  it('пакет → день → время → имя → пожелания → запись', async () => {
    await registerOwner()
    await bot.handleUpdate(message(CLIENT, '/start'))
    expect(data(tg.last(CLIENT))).toContain('bk')
    await bot.handleUpdate(press(CLIENT, 'bk'))
    expect(data(tg.last(CLIENT))).toContain('p:maximal')
    await bot.handleUpdate(press(CLIENT, 'p:maximal'))
    const dayBtn = data(tg.last(CLIENT)).find((d) => d.startsWith('d:'))!
    await bot.handleUpdate(press(CLIENT, dayBtn))
    const timeBtn = data(tg.last(CLIENT)).find((d) => d.startsWith('t:'))!
    await bot.handleUpdate(press(CLIENT, timeBtn))
    expect(tg.last(CLIENT).text).toContain('Как к вам обращаться')

    await bot.handleUpdate(message(CLIENT, 'Анна'))
    expect(tg.last(CLIENT).text).toContain('пожелания')
    await bot.handleUpdate(message(CLIENT, 'Хочу в лес <на закате>'))
    const confirm = tg.last(CLIENT)
    expect(confirm.text).toContain('Проверьте заявку')
    expect(confirm.text).toContain('&lt;на закате&gt;')
    expect(confirm.text).toContain('#privacy')

    await bot.handleUpdate(press(CLIENT, 'ok'))
    expect(tg.last(CLIENT).text).toContain('Заявка получена')
    const [b] = await allBookings()
    expect(b).toMatchObject({ package_id: 'maximal', name: 'Анна', contact: '@client', source: 'bot', client_chat: CLIENT })
    expect(b.date).toBe(dayBtn.split(':')[2])
    expect(`${b.date}:${b.time}`).toBe(timeBtn.split(':').slice(2).join(':'))
    const ownerMsg = tg.log.filter((m) => m.chat === OWNER).at(-1)!
    expect(ownerMsg.text).toContain('через бота')
    expect(ownerMsg.text).toContain(`tg://user?id=${CLIENT}`)

    // повторное нажатие не создаёт вторую заявку
    await bot.handleUpdate(press(CLIENT, 'ok'))
    expect(await allBookings()).toHaveLength(1)

    await bot.handleUpdate(press(OWNER, `c:${b.token}`, 'vaaaaaag'))
    expect(tg.last(CLIENT).text).toContain('Съёмка подтверждена')

    // клиент сам отменяет запись
    await bot.handleUpdate(press(CLIENT, 'my'))
    expect(data(tg.last(CLIENT))).toContain(`cx:${b.token}`)
    await bot.handleUpdate(press(CLIENT, `cx:${b.token}`))
    await bot.handleUpdate(press(CLIENT, `cy:${b.token}`))
    expect((await bot.store.getBooking(b.token))!.status).toBe('cancelled')
    expect(tg.log.filter((m) => m.chat === OWNER).at(-1)!.text).toContain('Клиент отменил')
  })

  it('имя кнопкой и без комментария', async () => {
    const { day, time } = await firstFree()
    await bot.handleUpdate(press(CLIENT, `t:minimal:${day}:${time}`))
    await bot.handleUpdate(press(CLIENT, 'n'))
    await bot.handleUpdate(press(CLIENT, 'nc'))
    await bot.handleUpdate(press(CLIENT, 'ok'))
    const [b] = await allBookings()
    expect(b).toMatchObject({ name: 'Аня', comment: '', package_id: 'minimal' })
  })

  it('/start book с сайта сразу открывает запись', async () => {
    await bot.handleUpdate(message(CLIENT, '/start book'))
    expect(tg.last(CLIENT).text).toContain('Выберите пакет')
  })

  it('занятое время не выбрать', async () => {
    const { day, time } = await firstFree()
    await siteBooking()
    await bot.handleUpdate(press(CLIENT, `t:standard:${day}:${time}`))
    expect(tg.calls).toContainEqual(['answer', 'Это время уже заняли'])
  })

  it('прайс, портфолио, контакты', async () => {
    await bot.handleUpdate(message(CLIENT, '/price'))
    expect(tg.last(CLIENT).text).toMatch(/15\s000 ₽/)
    await bot.handleUpdate(message(CLIENT, '/portfolio'))
    const [, params] = tg.calls.find(([m]) => m === 'sendMediaGroup')! as [string, { media: { media: string }[] }]
    expect(params.media[0].media).toMatch(/\/portfolio\/forest-road\.jpg$/)
    await bot.handleUpdate(message(CLIENT, '/contacts'))
    expect(tg.last(CLIENT).text).toContain('@vaaaaaag')
  })
})

describe('окно бота', () => {
  const visible = (chat: number) => [...(tg.visible.get(chat) ?? [])]

  it('портфолио → записаться → меню: старые сообщения заменяются, переписка не растёт', async () => {
    await bot.handleUpdate(message(CLIENT, '/start'))
    const menuId = tg.last(CLIENT).id
    expect(visible(CLIENT)).toEqual([menuId])

    await bot.handleUpdate(press(CLIENT, 'pf', 'client', menuId))
    const albumAndText = visible(CLIENT)
    expect(albumAndText).not.toContain(menuId) // меню удалено
    expect(albumAndText.length).toBe(6) // 5 фото + сообщение с кнопками
    const textId = tg.last(CLIENT).id

    await bot.handleUpdate(press(CLIENT, 'bk', 'client', textId))
    expect(visible(CLIENT)).toEqual([textId]) // альбом удалён, кнопки стали выбором пакета
    expect(tg.last(CLIENT).text).toContain('Выберите пакет')

    await bot.handleUpdate(press(CLIENT, 'm', 'client', textId))
    expect(visible(CLIENT)).toEqual([textId])
    expect(tg.last(CLIENT).text).toContain('Что дальше')

    // команда, набранная вручную, убирает старое окно и своё сообщение
    await bot.handleUpdate({ message: { ...message(CLIENT, '/price').message, message_id: 999 } })
    expect(visible(CLIENT)).toHaveLength(1)
    expect(visible(CLIENT)).not.toContain(textId)
    expect(tg.calls).toContainEqual(['deleteMessages', { chat_id: CLIENT, message_ids: [999] }])
  })

  it('шаги записи идут в одном сообщении, подтверждение остаётся в переписке', async () => {
    const { day, time } = await firstFree()
    await bot.handleUpdate(message(CLIENT, '/book'))
    const id = tg.last(CLIENT).id
    await bot.handleUpdate(press(CLIENT, `t:standard:${day}:${time}`, 'client', id))
    await bot.handleUpdate(message(CLIENT, 'Анна'))
    await bot.handleUpdate(message(CLIENT, 'Хочу в лес'))
    expect(visible(CLIENT)).toEqual([id])
    await bot.handleUpdate(press(CLIENT, 'ok', 'client', id))
    expect(tg.last(CLIENT).text).toContain('Заявка получена')

    // после «В меню» подтверждение не стирается — меню приходит новым сообщением
    await bot.handleUpdate(press(CLIENT, 'm', 'client', id))
    expect(visible(CLIENT)).toContain(id)
    expect(visible(CLIENT)).toHaveLength(2)
  })
})

describe('команды фотографа', () => {
  it('закрыть и открыть день', async () => {
    await registerOwner()
    const { day } = await firstFree()
    const [, m, d] = day.split('-')
    await bot.handleUpdate(message(OWNER, `/close ${+d}.${+m}`, 'vaaaaaag'))
    expect(tg.last(OWNER).text).toContain('закрыт')
    expect((await bot.freeSlots()).slots[day]).toBeUndefined()
    expect((await siteBooking({ date: day })).status).toBe(400)
    await bot.handleUpdate(message(OWNER, '/closed', 'vaaaaaag'))
    expect(tg.last(OWNER).text).toContain(formatDateRu(day, true))
    await bot.handleUpdate(message(OWNER, `/open ${day}`, 'vaaaaaag'))
    expect((await bot.freeSlots()).slots[day]).toBeDefined()

    // клиенту команды фотографа недоступны
    await bot.handleUpdate(message(CLIENT, `/close ${day}`))
    expect((await bot.freeSlots()).slots[day]).toBeDefined()
  })

  it('список ближайших записей', async () => {
    await registerOwner()
    await siteBooking()
    await bot.handleUpdate(message(OWNER, '/bookings', 'vaaaaaag'))
    expect(tg.last(OWNER).text).toContain('Ближайшие записи')
    expect(tg.last(OWNER).text).toContain('@anya')
  })
})

describe('вебхук и прочее', () => {
  it('без секрета Telegram — 403', async () => {
    const upd = message(CLIENT, '/start')
    expect((await call('POST', 'tg', upd)).status).toBe(403)
    const ok = await call('POST', 'tg', upd, { 'X-Telegram-Bot-Api-Secret-Token': await webhookSecret(tg.token) })
    expect(ok.status).toBe(200)
    expect(tg.log.length).toBeGreaterThan(0)
  })

  it('CORS для сайта', async () => {
    const res = await handle(new Request('https://bot.test/?r=slots', { method: 'OPTIONS' }), bot)
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('разбор дат для /close', () => {
    const now = new Date('2026-10-26T12:00:00+03:00')
    expect(parseDay('7.11', now)).toBe('2026-11-07')
    expect(parseDay('1.02', now)).toBe('2027-02-01')
    expect(parseDay('2026-12-31', now)).toBe('2026-12-31')
    expect(parseDay('31.02', now)).toBeNull()
  })

  it('одно окошко не занять дважды', async () => {
    const mk = (i: number): Booking => ({
      token: `t${i}`, created: 1, package_id: 'standard', package_name: 'С', package_price: 1, date: '2030-01-01', time: '12:00',
      name: 'n', contact: '@x', comment: '', status: 'new', source: 'site', client_chat: null, owner_msg: null, ip_hash: null,
    })
    const results = await Promise.allSettled([1, 2, 3, 4].map((i) => bot.store.createBooking(mk(i))))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await allBookings()).toHaveLength(1)
  })
})
