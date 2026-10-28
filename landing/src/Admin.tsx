/**
 * Админка фотографа (#admin): заявки, расписание, прайс, портфолио.
 * Работает только с сервером (server/): вход по паролю ADMIN_PASSWORD, сессия в cookie.
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, LogOut, Plus, RefreshCw, Trash2, Upload, X } from 'lucide-react'
import { formatDateRu, formatPrice } from '../shared/booking'

/* ---------- API ---------- */

class Unauthorized extends Error {}

function useApi(api: string) {
  return useCallback(
    async <T,>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> => {
      const { json, ...rest } = init
      const res = await fetch(`${api}${path}`, {
        credentials: 'same-origin',
        ...rest,
        headers: json !== undefined ? { 'Content-Type': 'application/json', ...rest.headers } : rest.headers,
        body: json !== undefined ? JSON.stringify(json) : rest.body,
      })
      if (res.status === 401 && path !== '/admin/login') throw new Unauthorized()
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { detail?: string }).detail ?? `Ошибка ${res.status}`)
      return data as T
    },
    [api],
  )
}
type Api = ReturnType<typeof useApi>

/* ---------- Типы ---------- */

type Status = 'new' | 'confirmed' | 'cancelled'
type Booking = {
  id: number
  status: Status
  packageName: string
  packagePrice: number
  date: string
  time: string
  name: string
  contact: string
  comment: string
  subscribed: boolean
  notified: boolean
  createdAt: string
}
type Schedule = {
  slot_times: string[]
  weekdays: number[]
  min_lead_days: number
  horizon_days: number
  blocked: { date: string; time: string }[]
}
type Pkg = {
  id: string
  name: string
  duration: string
  photos: string | null
  price: number
  tagline: string | null
  features: string[]
  note: string | null
  active: boolean
}
type Photo = { id: number; src: string; srcSm: string; w: number; h: number; alt: string }
type Series = { id: string; title: string; description: string; photos: Photo[] }
type Me = { telegram: { bot: string | null; tokenSet: boolean; ownerChatSet: boolean } }

/* ---------- Оформление ---------- */

const eyebrow = 'text-[10px] font-semibold uppercase tracking-[0.25em] text-white/40'
/** Поле ввода без ширины — для узких полей (время, дата). */
const fieldBase =
  'rounded-sm border border-white/15 bg-white/[0.03] px-3 py-2.5 text-[14px] text-white [color-scheme:dark] placeholder:text-white/30 focus:border-[#E8E6DC] focus:outline-none'
const input = `w-full ${fieldBase}`
const btn =
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-full border border-white/20 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white transition-colors hover:border-[#E8E6DC] hover:text-[#E8E6DC] disabled:cursor-default disabled:opacity-40'
const btnPrimary =
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-full bg-[#E8E6DC] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#121212] transition-colors hover:bg-white disabled:cursor-wait disabled:opacity-50'
const iconBtn =
  'inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-white/55 transition-colors hover:bg-white/10 hover:text-[#E8E6DC] disabled:cursor-default disabled:opacity-25'

const WEEKDAYS = [
  [1, 'Пн'],
  [2, 'Вт'],
  [3, 'Ср'],
  [4, 'Чт'],
  [5, 'Пт'],
  [6, 'Сб'],
  [0, 'Вс'],
] as const

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] text-white/55">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-white/35">{hint}</span>}
    </label>
  )
}

/** Кнопка удаления с подтверждением вторым нажатием (window.confirm в превью не работает). */
function DeleteButton({ onConfirm, label = 'Удалить' }: { onConfirm: () => void; label?: string }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(false), 4000)
    return () => window.clearTimeout(t)
  }, [armed])
  return (
    <button
      type="button"
      onClick={() => (armed ? onConfirm() : setArmed(true))}
      className={`${btn} ${armed ? 'border-red-300/60 text-red-200 hover:border-red-200 hover:text-red-100' : ''}`}
    >
      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
      {armed ? 'Точно удалить?' : label}
    </button>
  )
}

/* ---------- Страница ---------- */

type Tab = 'bookings' | 'schedule' | 'packages' | 'portfolio'
const TABS: [Tab, string][] = [
  ['bookings', 'Заявки'],
  ['schedule', 'Расписание'],
  ['packages', 'Прайс'],
  ['portfolio', 'Портфолио'],
]

export default function AdminPage({ api }: { api: string | null }) {
  if (!api) {
    return (
      <Shell>
        <p className="max-w-[520px] text-[14px] leading-relaxed text-white/60">
          Админка работает только на сайте с сервером. В этом превью сервера нет — запустите сайт по инструкции из
          DEPLOY.md.
        </p>
      </Shell>
    )
  }
  return <AdminApp api={api} />
}

function Shell({ children, onLogout }: { children: ReactNode; onLogout?: () => void }) {
  return (
    <div className="min-h-[100svh] bg-[#020202] font-sans text-white selection:bg-[#E8E6DC] selection:text-[#121212]">
      <header className="flex items-center justify-between gap-6 border-b border-white/10 px-6 py-5 md:px-10">
        <a href="#" className="flex items-center gap-4">
          <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" width={36} height={36} className="h-9 w-9" />
          <span className="font-serif text-2xl text-[#E8E6DC]">Админка</span>
        </a>
        <div className="flex items-center gap-3">
          <a href="#" className={`${btn} whitespace-nowrap`} aria-label="На сайт">
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
            <span className="hidden sm:inline">На сайт</span>
          </a>
          {onLogout && (
            <button type="button" onClick={onLogout} className={`${btn} whitespace-nowrap`} aria-label="Выйти">
              <LogOut className="h-3.5 w-3.5" strokeWidth={1.8} />
              <span className="hidden sm:inline">Выйти</span>
            </button>
          )}
        </div>
      </header>
      <main className="px-6 py-8 md:px-10">{children}</main>
    </div>
  )
}

function AdminApp({ api: base }: { api: string }) {
  const api = useApi(base)
  const [auth, setAuth] = useState<'checking' | 'in' | 'out'>('checking')
  const [me, setMe] = useState<Me | null>(null)
  const [tab, setTab] = useState<Tab>('bookings')

  const checkMe = useCallback(() => {
    api<Me>('/admin/me')
      .then((m) => {
        setMe(m)
        setAuth('in')
      })
      .catch(() => setAuth('out'))
  }, [api])
  useEffect(checkMe, [checkMe])

  // Любой запрос получил 401 — сессия истекла
  const guarded: Api = useCallback(
    async (path, init) => {
      try {
        return await api(path, init)
      } catch (e) {
        if (e instanceof Unauthorized) setAuth('out')
        throw e
      }
    },
    [api],
  ) as Api

  if (auth === 'checking') return <Shell>{null}</Shell>
  if (auth === 'out') return <Login api={api} onDone={checkMe} />

  return (
    <Shell
      onLogout={() => {
        api('/admin/logout', { method: 'POST' }).finally(() => setAuth('out'))
      }}
    >
      {me && <TelegramNotice me={me} />}
      <nav className="mb-8 flex flex-wrap gap-1 rounded-full border border-white/10 p-1 sm:inline-flex" role="tablist">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`cursor-pointer rounded-full px-4 py-2 text-[12px] font-medium transition-colors ${
              tab === id ? 'bg-[#E8E6DC] text-[#121212]' : 'text-white/60 hover:text-[#E8E6DC]'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === 'bookings' && <Bookings api={guarded} />}
      {tab === 'schedule' && <ScheduleTab api={guarded} />}
      {tab === 'packages' && <Packages api={guarded} />}
      {tab === 'portfolio' && <Portfolio api={guarded} />}
    </Shell>
  )
}

function Login({ api, onDone }: { api: Api; onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api('/admin/login', { method: 'POST', json: { password } })
      onDone()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Shell>
      <form onSubmit={submit} className="flex max-w-[360px] flex-col gap-4">
        <p className={eyebrow}>Вход</p>
        <Field label="Пароль">
          <input
            id="admin-password"
            type="password"
            autoComplete="current-password"
            className={input}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </Field>
        {error && (
          <p role="alert" className="text-[13px] text-[#E8E6DC]">
            {error}
          </p>
        )}
        <button type="submit" className={`${btnPrimary} self-start`} disabled={busy || !password}>
          Войти
        </button>
      </form>
    </Shell>
  )
}

function TelegramNotice({ me }: { me: Me }) {
  const t = me.telegram
  if (t.tokenSet && t.ownerChatSet && t.bot) return null
  const text = !t.tokenSet
    ? 'Бот Telegram не подключён: заявки видны только здесь. Впишите TELEGRAM_BOT_TOKEN на сервере (DEPLOY.md).'
    : !t.ownerChatSet
      ? `Бот ${t.bot ? '@' + t.bot : ''} подключён, но не знает, кому слать заявки. Напишите ему /start — он пришлёт ваш chat id, впишите его в TELEGRAM_OWNER_CHAT_ID.`
      : 'Бот не отвечает — проверьте токен TELEGRAM_BOT_TOKEN.'
  return <p className="mb-6 max-w-[760px] rounded-sm border border-white/15 bg-white/[0.03] p-4 text-[13px] leading-relaxed text-white/70">{text}</p>
}

function useLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(() => {
    setError(null)
    load()
      .then(setData)
      .catch((e: Error) => setError(e.message))
  }, [load])
  useEffect(reload, [reload])
  return { data, setData, error, setError, reload }
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="my-4 text-[13px] text-red-200">
      {error}
    </p>
  ) : null
}

/* ---------- Заявки ---------- */

const STATUS: Record<Status, [string, string]> = {
  new: ['Новая', 'border-[#E8E6DC] text-[#E8E6DC]'],
  confirmed: ['Подтверждена', 'border-[#E8E6DC] bg-[#E8E6DC] text-[#121212]'],
  cancelled: ['Отменена', 'border-white/15 text-white/40'],
}

function contactHref(contact: string): string | null {
  const c = contact.trim()
  if (/^@[\w\d_]{3,}$/.test(c)) return `https://t.me/${c.slice(1)}`
  if (/^\+?[\d\s()-]{7,}$/.test(c)) return `tel:${c.replace(/[^\d+]/g, '')}`
  return null
}

function Bookings({ api }: { api: Api }) {
  const [scope, setScope] = useState<'upcoming' | 'past' | 'all'>('upcoming')
  const load = useCallback(() => api<Booking[]>(`/admin/bookings?scope=${scope}`), [api, scope])
  const { data, setData, error, setError, reload } = useLoad(load)

  async function act(b: Booking, action: Status | 'delete') {
    try {
      if (action === 'delete') {
        await api(`/admin/bookings/${b.id}`, { method: 'DELETE' })
        setData((d) => d?.filter((x) => x.id !== b.id) ?? null)
      } else {
        const upd = await api<Booking>(`/admin/bookings/${b.id}`, { method: 'PATCH', json: { status: action } })
        setData((d) => d?.map((x) => (x.id === b.id ? upd : x)) ?? null)
      }
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const fresh = data?.filter((b) => b.status === 'new').length ?? 0
  return (
    <section>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        {(
          [
            ['upcoming', 'Предстоящие'],
            ['past', 'Прошедшие'],
            ['all', 'Все'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setScope(id)} className={`${btn} ${scope === id ? 'border-[#E8E6DC] text-[#E8E6DC]' : ''}`}>
            {label}
          </button>
        ))}
        <button type="button" onClick={reload} className={iconBtn} aria-label="Обновить">
          <RefreshCw className="h-4 w-4" strokeWidth={1.8} />
        </button>
        {fresh > 0 && <span className="text-[12px] text-white/55">Новых: {fresh}</span>}
      </div>
      <ErrorLine error={error} />
      {data && data.length === 0 && <p className="text-[14px] text-white/45">Заявок пока нет.</p>}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {data?.map((b) => {
          const href = contactHref(b.contact)
          return (
            <article key={b.id} className={`rounded-sm border border-white/10 p-5 ${b.status === 'cancelled' ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-serif text-2xl text-white">
                    {formatDateRu(b.date)}, {b.time}
                  </p>
                  <p className="mt-1 text-[13px] text-white/55">
                    {b.packageName} · {formatPrice(b.packagePrice)} · заявка #{b.id}
                  </p>
                </div>
                <span className={`rounded-full border px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] ${STATUS[b.status][1]}`}>
                  {STATUS[b.status][0]}
                </span>
              </div>
              <dl className="mt-4 grid grid-cols-[6rem_1fr] gap-x-4 gap-y-1.5 text-[13.5px]">
                <dt className="text-white/40">Имя</dt>
                <dd>{b.name}</dd>
                <dt className="text-white/40">Связь</dt>
                <dd>
                  {href ? (
                    <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-[#E8E6DC]">
                      {b.contact}
                    </a>
                  ) : (
                    b.contact
                  )}
                  {b.subscribed && <span className="ml-2 text-[11.5px] text-white/45">· подписан на бота</span>}
                </dd>
                {b.comment && (
                  <>
                    <dt className="text-white/40">Идея</dt>
                    <dd className="whitespace-pre-wrap text-white/80">{b.comment}</dd>
                  </>
                )}
              </dl>
              {!b.notified && b.status === 'new' && (
                <p className="mt-3 text-[12px] text-white/45">В Telegram ещё не доставлено — бот повторит отправку.</p>
              )}
              <div className="mt-5 flex flex-wrap gap-2">
                {b.status === 'new' && (
                  <button type="button" onClick={() => act(b, 'confirmed')} className={btnPrimary}>
                    <Check className="h-3.5 w-3.5" strokeWidth={2} /> Подтвердить
                  </button>
                )}
                {b.status !== 'cancelled' && (
                  <button type="button" onClick={() => act(b, 'cancelled')} className={btn}>
                    <X className="h-3.5 w-3.5" strokeWidth={2} /> Отменить
                  </button>
                )}
                <DeleteButton onConfirm={() => act(b, 'delete')} />
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

/* ---------- Расписание ---------- */

function ScheduleTab({ api }: { api: Api }) {
  const load = useCallback(() => api<Schedule>('/admin/schedule'), [api])
  const { data, setData, error, setError, reload } = useLoad(load)
  const [newTime, setNewTime] = useState('')
  const [saved, setSaved] = useState(false)
  const [block, setBlock] = useState({ date: '', time: '' })

  if (!data) return <ErrorLine error={error} />

  async function save() {
    try {
      const { blocked: _blocked, ...sched } = data!
      void _blocked
      const res = await api<Omit<Schedule, 'blocked'>>('/admin/schedule', { method: 'PUT', json: sched })
      setData({ ...data!, ...res })
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function addBlock(e: FormEvent) {
    e.preventDefault()
    try {
      await api('/admin/blocked', { method: 'POST', json: block })
      setBlock({ date: '', time: '' })
      reload()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function removeBlock(b: { date: string; time: string }) {
    await api(`/admin/blocked?date=${b.date}&time=${encodeURIComponent(b.time)}`, { method: 'DELETE' }).catch((e: Error) => setError(e.message))
    reload()
  }

  return (
    <div className="grid grid-cols-1 gap-12 xl:grid-cols-2">
      <section className="flex flex-col gap-6">
        <p className={eyebrow}>Когда идёт запись</p>
        <Field label="Время начала съёмок" hint="Каждое время — отдельное окошко. Время — по Петербургу.">
          <div className="flex flex-wrap items-center gap-2">
            {data.slot_times.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-full border border-white/20 py-1 pl-3 pr-1 text-[13px] tabular-nums">
                {t}
                <button
                  type="button"
                  aria-label={`Убрать ${t}`}
                  onClick={() => setData({ ...data, slot_times: data.slot_times.filter((x) => x !== t) })}
                  className={iconBtn}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
            <input id="new-slot-time" type="time" className={`${fieldBase} w-[130px]`} value={newTime} onChange={(e) => setNewTime(e.target.value)} />
            <button
              type="button"
              className={btn}
              disabled={!newTime || data.slot_times.includes(newTime)}
              onClick={() => {
                setData({ ...data, slot_times: [...data.slot_times, newTime].sort() })
                setNewTime('')
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Добавить
            </button>
          </div>
        </Field>
        <Field label="Рабочие дни">
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map(([d, label]) => {
              const on = data.weekdays.includes(d)
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setData({ ...data, weekdays: on ? data.weekdays.filter((x) => x !== d) : [...data.weekdays, d] })}
                  className={`h-10 w-11 cursor-pointer rounded-full border text-[13px] transition-colors ${
                    on ? 'border-[#E8E6DC] bg-[#E8E6DC] text-[#121212]' : 'border-white/15 text-white/50 hover:border-white/40'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Запись не раньше чем за, дней">
            <input
              id="min-lead"
              type="number"
              min={0}
              max={30}
              className={input}
              value={data.min_lead_days}
              onChange={(e) => setData({ ...data, min_lead_days: Number(e.target.value) })}
            />
          </Field>
          <Field label="Запись открыта вперёд, дней">
            <input
              id="horizon"
              type="number"
              min={7}
              max={365}
              className={input}
              value={data.horizon_days}
              onChange={(e) => setData({ ...data, horizon_days: Number(e.target.value) })}
            />
          </Field>
        </div>
        <ErrorLine error={error} />
        <button type="button" onClick={save} className={`${btnPrimary} self-start`}>
          {saved ? <Check className="h-3.5 w-3.5" /> : null}
          {saved ? 'Сохранено' : 'Сохранить расписание'}
        </button>
      </section>

      <section className="flex flex-col gap-6">
        <p className={eyebrow}>Выходные и занятое время</p>
        <form onSubmit={addBlock} className="flex flex-wrap items-end gap-3">
          <Field label="Дата">
            <input id="block-date" type="date" required className={`${fieldBase} w-[170px]`} value={block.date} onChange={(e) => setBlock({ ...block, date: e.target.value })} />
          </Field>
          <Field label="Что закрыть">
            <select id="block-time" className={`${fieldBase} w-[170px]`} value={block.time} onChange={(e) => setBlock({ ...block, time: e.target.value })}>
              <option value="">Весь день</option>
              {data.slot_times.map((t) => (
                <option key={t} value={t}>
                  Только {t}
                </option>
              ))}
            </select>
          </Field>
          <button type="submit" className={btn} disabled={!block.date}>
            <Plus className="h-3.5 w-3.5" /> Закрыть
          </button>
        </form>
        {data.blocked.length === 0 ? (
          <p className="text-[13px] text-white/45">Закрытых дней нет.</p>
        ) : (
          <ul className="divide-y divide-white/10 border-y border-white/10">
            {data.blocked.map((b) => (
              <li key={b.date + b.time} className="flex items-center justify-between py-2.5 text-[14px]">
                <span>
                  {formatDateRu(b.date, true)} — <span className="text-white/55">{b.time ? `только ${b.time}` : 'весь день'}</span>
                </span>
                <button type="button" onClick={() => removeBlock(b)} className={iconBtn} aria-label="Открыть снова">
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/* ---------- Прайс ---------- */

const EMPTY_PKG: Pkg = { id: '', name: '', duration: '', photos: '', price: 0, tagline: '', features: [], note: '', active: true }

function Packages({ api }: { api: Api }) {
  const load = useCallback(() => api<Pkg[]>('/admin/packages'), [api])
  const { data, setData, error, setError, reload } = useLoad(load)
  const [adding, setAdding] = useState(false)

  async function move(i: number, step: number) {
    if (!data) return
    const list = [...data]
    ;[list[i], list[i + step]] = [list[i + step], list[i]]
    setData(list)
    await api('/admin/packages/reorder', { method: 'POST', json: { ids: list.map((p) => p.id) } }).catch((e: Error) => setError(e.message))
  }

  return (
    <section className="flex flex-col gap-4">
      <p className="max-w-[640px] text-[13px] leading-relaxed text-white/50">
        Пакеты из этого списка видны на странице «Прайс», на главной и в записи. Цены в уже отправленных заявках не меняются.
      </p>
      <ErrorLine error={error} />
      {data?.map((p, i) => (
        <PackageCard
          key={p.id}
          pkg={p}
          api={api}
          onSaved={(np) => setData(data.map((x) => (x.id === p.id ? np : x)))}
          onDeleted={() => setData(data.filter((x) => x.id !== p.id))}
          onUp={i > 0 ? () => move(i, -1) : undefined}
          onDown={i < data.length - 1 ? () => move(i, 1) : undefined}
        />
      ))}
      {adding ? (
        <PackageCard
          pkg={EMPTY_PKG}
          api={api}
          isNew
          onSaved={() => {
            setAdding(false)
            reload()
          }}
          onDeleted={() => setAdding(false)}
        />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className={`${btn} self-start`}>
          <Plus className="h-3.5 w-3.5" /> Добавить пакет
        </button>
      )}
    </section>
  )
}

function PackageCard(props: {
  pkg: Pkg
  api: Api
  isNew?: boolean
  onSaved: (p: Pkg) => void
  onDeleted: () => void
  onUp?: () => void
  onDown?: () => void
}) {
  const { pkg, api, isNew } = props
  const [f, setF] = useState({ ...pkg, features: pkg.features.join('\n') })
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const id = isNew ? 'new' : pkg.id

  async function save(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const body = { ...f, price: Number(f.price), features: f.features.split('\n') }
    try {
      const res = isNew
        ? await api<Pkg>('/admin/packages', { method: 'POST', json: body })
        : await api<Pkg>(`/admin/packages/${pkg.id}`, { method: 'PUT', json: body })
      props.onSaved(res)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function remove() {
    if (isNew) return props.onDeleted()
    try {
      await api(`/admin/packages/${pkg.id}`, { method: 'DELETE' })
      props.onDeleted()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <form onSubmit={save} className={`rounded-sm border p-5 ${f.active ? 'border-white/10' : 'border-dashed border-white/15 opacity-70'}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="font-serif text-2xl text-white">{f.name || 'Новый пакет'}</p>
        {!isNew && (
          <div className="flex items-center gap-1">
            <button type="button" onClick={props.onUp} disabled={!props.onUp} className={iconBtn} aria-label="Выше">
              <ArrowUp className="h-4 w-4" />
            </button>
            <button type="button" onClick={props.onDown} disabled={!props.onDown} className={iconBtn} aria-label="Ниже">
              <ArrowDown className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Field label="Название">
          <input id={`pkg-name-${id}`} className={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Цена, ₽">
          <input id={`pkg-price-${id}`} type="number" min={0} step={100} className={input} value={f.price} onChange={(e) => setF({ ...f, price: Number(e.target.value) })} />
        </Field>
        <Field label="Длительность">
          <input id={`pkg-duration-${id}`} className={input} placeholder="2 часа" value={f.duration} onChange={(e) => setF({ ...f, duration: e.target.value })} />
        </Field>
        <Field label="Сколько фото">
          <input id={`pkg-photos-${id}`} className={input} placeholder="50 фото" value={f.photos ?? ''} onChange={(e) => setF({ ...f, photos: e.target.value })} />
        </Field>
        <div className="md:col-span-2">
          <Field label="Что входит" hint="Каждый пункт — с новой строки.">
            <textarea id={`pkg-features-${id}`} className={`${input} min-h-[140px]`} value={f.features} onChange={(e) => setF({ ...f, features: e.target.value })} />
          </Field>
        </div>
        <div className="flex flex-col gap-4 md:col-span-2">
          <Field label="Фраза под названием">
            <input id={`pkg-tagline-${id}`} className={input} value={f.tagline ?? ''} onChange={(e) => setF({ ...f, tagline: e.target.value })} />
          </Field>
          <Field label="Подпись под ценой">
            <input id={`pkg-note-${id}`} className={input} value={f.note ?? ''} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </Field>
          <label className="flex cursor-pointer items-center gap-3 text-[13px] text-white/70">
            <input id={`pkg-active-${id}`} type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} className="h-4 w-4 accent-[#E8E6DC]" />
            Показывать на сайте и в записи
          </label>
        </div>
      </div>
      <ErrorLine error={error} />
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="submit" className={btnPrimary}>
          {saved ? <Check className="h-3.5 w-3.5" /> : null}
          {saved ? 'Сохранено' : isNew ? 'Добавить' : 'Сохранить'}
        </button>
        {isNew ? (
          <button type="button" onClick={remove} className={btn}>
            Отмена
          </button>
        ) : (
          <DeleteButton onConfirm={remove} />
        )}
      </div>
    </form>
  )
}

/* ---------- Портфолио ---------- */

function Portfolio({ api }: { api: Api }) {
  const load = useCallback(() => api<Series[]>('/admin/series'), [api])
  const { data, setData, error, setError, reload } = useLoad(load)
  const [title, setTitle] = useState('')

  async function addSeries(e: FormEvent) {
    e.preventDefault()
    try {
      await api('/admin/series', { method: 'POST', json: { title, description: '' } })
      setTitle('')
      reload()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function move(i: number, step: number) {
    if (!data) return
    const list = [...data]
    ;[list[i], list[i + step]] = [list[i + step], list[i]]
    setData(list)
    await api('/admin/series/reorder', { method: 'POST', json: { ids: list.map((s) => s.id) } }).catch((e: Error) => setError(e.message))
  }

  return (
    <section className="flex flex-col gap-6">
      <p className="max-w-[680px] text-[13px] leading-relaxed text-white/50">
        Серии видны на странице «Портфолио». Первое фото серии — её обложка на главной, поэтому лучше вертикальное. Серии без фото на
        сайте не показываются.
      </p>
      <ErrorLine error={error} />
      {data?.map((s, i) => (
        <SeriesCard
          key={s.id}
          series={s}
          api={api}
          onChange={reload}
          onUp={i > 0 ? () => move(i, -1) : undefined}
          onDown={i < data.length - 1 ? () => move(i, 1) : undefined}
        />
      ))}
      <form onSubmit={addSeries} className="flex flex-wrap items-end gap-3">
        <Field label="Новая серия">
          <input id="new-series-title" className={`${fieldBase} w-[280px] max-w-full`} placeholder="Название серии" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <button type="submit" className={btn} disabled={!title.trim()}>
          <Plus className="h-3.5 w-3.5" /> Добавить серию
        </button>
      </form>
    </section>
  )
}

function SeriesCard(props: { series: Series; api: Api; onChange: () => void; onUp?: () => void; onDown?: () => void }) {
  const { series, api } = props
  const [f, setF] = useState({ title: series.title, description: series.description })
  const [photos, setPhotos] = useState(series.photos)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => setPhotos(series.photos), [series.photos])

  async function saveMeta(e: FormEvent) {
    e.preventDefault()
    try {
      await api(`/admin/series/${series.id}`, { method: 'PUT', json: f })
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return
    setUploading(true)
    setError(null)
    const fd = new FormData()
    for (const file of files) fd.append('files', file)
    try {
      const res = await api<{ added: Photo[]; errors: string[] }>(`/admin/series/${series.id}/photos`, { method: 'POST', body: fd })
      setPhotos((p) => [...p, ...res.added])
      if (res.errors.length) setError(res.errors.join('\n'))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  async function movePhoto(i: number, step: number) {
    const list = [...photos]
    ;[list[i], list[i + step]] = [list[i + step], list[i]]
    setPhotos(list)
    await api(`/admin/series/${series.id}/photos/reorder`, { method: 'POST', json: { ids: list.map((p) => p.id) } }).catch((e: Error) =>
      setError(e.message),
    )
  }

  async function removePhoto(p: Photo) {
    try {
      await api(`/admin/photos/${p.id}`, { method: 'DELETE' })
      setPhotos((list) => list.filter((x) => x.id !== p.id))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function saveAlt(p: Photo, alt: string) {
    if (alt === p.alt) return
    await api(`/admin/photos/${p.id}`, { method: 'PATCH', json: { alt } }).catch((e: Error) => setError(e.message))
    setPhotos((list) => list.map((x) => (x.id === p.id ? { ...x, alt } : x)))
  }

  async function removeSeries() {
    try {
      await api(`/admin/series/${series.id}`, { method: 'DELETE' })
      props.onChange()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <article className="rounded-sm border border-white/10 p-5">
      <form onSubmit={saveMeta} className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_2fr_auto] md:items-end">
        <Field label="Название серии">
          <input id={`series-title-${series.id}`} className={input} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label="Описание">
          <input id={`series-desc-${series.id}`} className={input} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <div className="flex items-center gap-1">
          <button type="submit" className={btnPrimary}>
            {saved ? 'Сохранено' : 'Сохранить'}
          </button>
          <button type="button" onClick={props.onUp} disabled={!props.onUp} className={iconBtn} aria-label="Серию выше">
            <ArrowUp className="h-4 w-4" />
          </button>
          <button type="button" onClick={props.onDown} disabled={!props.onDown} className={iconBtn} aria-label="Серию ниже">
            <ArrowDown className="h-4 w-4" />
          </button>
        </div>
      </form>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {photos.map((p, i) => (
          <figure key={p.id} className="flex flex-col gap-2">
            <div className="relative aspect-[4/5] overflow-hidden rounded-sm bg-white/5">
              <img src={p.srcSm} alt={p.alt} loading="lazy" className="h-full w-full object-cover" />
              {i === 0 && (
                <span className="absolute left-2 top-2 rounded-full bg-[#020202]/80 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[#E8E6DC]">
                  Обложка
                </span>
              )}
            </div>
            <input
              className={`${input} py-1.5 text-[12px]`}
              defaultValue={p.alt}
              placeholder="Подпись для незрячих"
              aria-label="Подпись к фото"
              onBlur={(e) => saveAlt(p, e.target.value)}
            />
            <div className="flex items-center justify-between">
              <div className="flex">
                <button type="button" onClick={() => movePhoto(i, -1)} disabled={i === 0} className={iconBtn} aria-label="Раньше">
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => movePhoto(i, 1)} disabled={i === photos.length - 1} className={iconBtn} aria-label="Позже">
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
              <button type="button" onClick={() => removePhoto(p)} className={iconBtn} aria-label="Удалить фото">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </figure>
        ))}
        <label className="flex aspect-[4/5] cursor-pointer flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-white/20 text-center text-[12px] text-white/55 transition-colors hover:border-[#E8E6DC] hover:text-[#E8E6DC]">
          <Upload className="h-5 w-5" strokeWidth={1.6} />
          {uploading ? 'Загружаю…' : 'Добавить фото'}
          <span className="text-[10.5px] text-white/35">JPEG, PNG, WebP · можно несколько</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            disabled={uploading}
            onChange={(e) => {
              upload(e.target.files)
              e.target.value = ''
            }}
          />
        </label>
      </div>

      <ErrorLine error={error} />
      <div className="mt-5">
        <DeleteButton onConfirm={removeSeries} label="Удалить серию" />
      </div>
    </article>
  )
}
