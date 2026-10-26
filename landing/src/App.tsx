import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, Check, Copy, Send, X } from 'lucide-react'
import {
  PACKAGES,
  SLOT_TIMES,
  addDays,
  allSlots,
  bookingMessage,
  bookingWindow,
  formatDateRu,
  formatPrice,
  LIMITS,
  packageSummary,
  validateBooking,
  validateContactFields,
  weekday,
  type BookingRequest,
  type Package,
  type PackageId,
} from '../shared/booking'

/**
 * Адрес API сервера (server/). По умолчанию /api на том же сайте.
 * VITE_DEMO=1 — сборка без сервера (превью): данные по умолчанию, запись в демо-режиме.
 */
const API: string | null =
  import.meta.env.VITE_DEMO === '1' ? null : ((import.meta.env.VITE_API_BASE as string | undefined) ?? '/api').replace(/\/$/, '')

/** Админка — отдельный файл, грузится только при входе в неё. */
const AdminPage = lazy(() => import('./Admin'))

/* ---------- Константы ---------- */

const ACCENT = '#E8E6DC'
const TELEGRAM_CHANNEL = 'https://t.me/Vaag_ph'
const TELEGRAM_PERSONAL = 'https://t.me/vaaaaaag'
const INSTAGRAM = 'https://instagram.com/vaag.ph'
/** Адрес сайта — из SITE_URL при сборке (бесплатный домен или свой). */
const SITE = import.meta.env.VITE_SITE_URL as string
const SITE_HOST = SITE.replace(/^https?:\/\//, '')

/** Путь к файлу из /public с учётом base, чтобы сборка работала не только из корня сайта. */
const asset = (file: string) => `${import.meta.env.BASE_URL}${file}`

const LERP_SCROLL = 0.05
const LERP_VIDEO = 0.08


type Panel = {
  id: 1 | 2
  category: string
  title: string
  description: string
  image: string
  packages: Package[]
}

/** Панели на главной: первая — все пакеты, вторая — самый полный (дорогой). */
function buildPanels(packages: Package[]): Record<1 | 2, Panel> {
  const list = packages.length ? packages : PACKAGES
  const top = list.reduce((a, b) => (b.price > a.price ? b : a))
  return {
  1: {
    id: 1,
    category: 'Серия · Лес и туман',
    title: list.length === 3 ? list.map((p) => p.name).join(', ').replace(/, ([^,]*)$/, ' и $1') : 'Пакеты съёмки',
    description:
      'Неспешная прогулка по лесу или берегу залива на рассвете. Туман, влажный воздух, мягкий свет — и ты в нём.',
    image: asset('series1.jpg'),
    packages: list,
  },
  2: {
    id: 2,
    category: 'Серия · Тёмные образы',
    title: `${top.name} пакет`,
    description:
      'Длинная съёмка с несколькими образами и локациями. Глубокие тени, вода, драматичный свет — история целиком.',
    image: asset('series2.jpg'),
    packages: [top],
  },
}
}

/** Рассказ о себе — текст автора. Новые абзацы просто добавляются в массив `paragraphs`. */
const ABOUT = {
  title: 'Портретный фотограф',
  titleAccent: 'в Санкт-Петербурге',
  /** Биография: от прошлого к планам. */
  bio: [
    'В 2025 году я начал свой путь в мире фотографии, записавшись на курсы по основам фотосъемки.',
    'В дальнейшем я планирую продолжить развиваться как фотограф, участвовать в международных выставках и конкурсах.',
  ],
  paragraphs: [
    'Я Вааг — фотограф с опытом в различных жанрах, включая портретную, рекламную и пейзажную фотографию. Мой подход к съемке основан на стремлении запечатлеть настоящие эмоции и уникальность каждого момента, ведь именно они делают фотографии по-настоящему живыми. Я верю в силу рассказа через изображение и стремлюсь создать атмосферу доверия, чтобы помочь своим клиентам раскрыться и почувствовать себя комфортно перед объективом.',
  ],
}

/* ---------- Портфолио ----------
 * На работающем сайте серии и фото приходят с сервера — их добавляют в админке.
 * DEFAULT_SERIES — запасной вариант для превью без сервера.
 * Первое фото серии — её обложка на первом экране, поэтому лучше вертикальное. */
type Photo = { id: string | number; src: string; srcSm: string; w: number; h: number; alt: string }
type Series = { id: string; title: string; description: string; photos: Photo[] }

const bundled = (id: string, w: number, h: number, alt: string): Photo => ({
  id,
  src: asset(`portfolio/${id}.jpg`),
  srcSm: asset(`portfolio/${id}-sm.jpg`),
  w,
  h,
  alt,
})

const DEFAULT_SERIES: Series[] = [
  {
    id: 'forest',
    // Название — временное, до ответа автора
    title: 'Лес и туман',
    description: 'Одна съёмка — от лесной тропы и старых елей до каменных готических арок.',
    photos: [
      bundled('forest-road', 2, 3, 'Девушка на лесной дороге запрокинула голову к свету'),
      bundled('forest-tree', 2, 3, 'Портрет у ствола старой ели'),
      bundled('dark-arch', 2, 3, 'Кружение в белой юбке под каменной аркой'),
      bundled('forest-road-warm', 2, 3, 'Лесная дорога, тёплый вариант обработки'),
      bundled('dark-door', 3, 2, 'Портрет у готической двери склепа'),
    ],
  },
]

type Shot = Photo & { series: Series }
const shotsOf = (series: Series[], filter: string): Shot[] =>
  series.filter((x) => filter === 'all' || x.id === filter).flatMap((x) =>
    x.photos.map((photo) => ({ ...photo, series: x })),
  )

/* ---------- Данные с сервера ---------- */

type Content = { packages: Package[]; series: Series[]; telegramBot: string | null; live: boolean }

const DEFAULT_CONTENT: Content = { packages: PACKAGES, series: DEFAULT_SERIES, telegramBot: null, live: false }

const ContentContext = createContext<Content>(DEFAULT_CONTENT)
const useContent = () => useContext(ContentContext)

/** Пакеты и портфолио с сервера; без сервера остаются значения по умолчанию. */
function useServerContent(): Content {
  const [content, setContent] = useState(DEFAULT_CONTENT)
  useEffect(() => {
    if (!API) return
    fetch(`${API}/content`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: Omit<Content, 'live'>) =>
        setContent({
          packages: data.packages.length ? data.packages : PACKAGES,
          series: data.series,
          telegramBot: data.telegramBot,
          live: true,
        }),
      )
      .catch(() => {
        /* сервер недоступен — работаем на данных по умолчанию */
      })
  }, [])
  return content
}

const NAV = [
  { label: 'Портфолио', target: 'portfolio' as const },
  { label: 'Прайс', target: 'price' as const },
  { label: 'Обо мне', target: 0.7 },
  { label: 'Контакты', target: 'contacts' as const },
]

/* ---------- Хелперы ---------- */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** «1 серия», «2 серии», «5 серий» */
function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return `${n} ${one}`
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} ${few}`
  return `${n} ${many}`
}


/* ---------- Страницы ----------
 * Главная — без хеша. Отдельные страницы: #portfolio (или #portfolio-<серия>), #price, #privacy,
 * #booking-<код> (статус заявки для клиента) и #admin (админка).
 * Хеш, а не путь: так страница работает на любом хостинге и кнопка «Назад» в браузере тоже. */
type Route =
  | { page: 'home' }
  | { page: 'portfolio'; series: string }
  | { page: 'price' }
  | { page: 'privacy' }
  | { page: 'admin' }
  | { page: 'booking'; token: string }

function readRoute(): Route {
  if (window.location.hash === '#price') return { page: 'price' }
  if (window.location.hash === '#privacy') return { page: 'privacy' }
  if (window.location.hash === '#admin') return { page: 'admin' }
  const b = window.location.hash.match(/^#booking-([\w-]+)$/)
  if (b) return { page: 'booking', token: b[1] }
  const m = window.location.hash.match(/^#portfolio(?:-([\w-]+))?$/)
  if (!m) return { page: 'home' }
  return { page: 'portfolio', series: m[1] ?? 'all' }
}

function openPortfolio(seriesId?: string) {
  window.location.hash = seriesId ? `portfolio-${seriesId}` : 'portfolio'
}

function openPrice() {
  window.location.hash = 'price'
}

function goHome() {
  window.location.hash = ''
}

function useRoute() {
  const [route, setRoute] = useState(readRoute)
  useEffect(() => {
    const onHash = () => {
      setRoute(readRoute())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return route
}

/**
 * Поведение окна поверх страницы: страница под ним не прокручивается,
 * фокус переходит на кнопку закрытия, Esc закрывает. `onKey` — дополнительные клавиши.
 */
function useModal(
  active: boolean,
  onClose: () => void,
  focusRef: React.RefObject<HTMLElement | null>,
  onKey?: (e: KeyboardEvent) => void,
) {
  const onKeyRef = useRef(onKey)
  onKeyRef.current = onKey
  useEffect(() => {
    if (!active) return
    const root = document.documentElement
    const prevOverflow = root.style.overflow
    root.style.overflow = 'hidden'
    focusRef.current?.focus()
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else onKeyRef.current?.(e)
    }
    window.addEventListener('keydown', handler)
    return () => {
      root.style.overflow = prevOverflow
      window.removeEventListener('keydown', handler)
    }
  }, [active, onClose, focusRef])
}

/** Сколько пикселей прокрутки занимает сцена с видео (всё, что до блока контактов). */
function stageScrollLength() {
  const stage = document.getElementById('stage')
  return stage ? Math.max(0, stage.offsetHeight - window.innerHeight) : 0
}

function scrollToFraction(fraction: number) {
  window.scrollTo({ top: fraction * stageScrollLength(), behavior: 'smooth' })
}

/** Элемент исчезает (fade + blur + подъём), пока прогресс идёт от start к end. */
function getStaggerStyle(progress: number, start: number, end: number): CSSProperties {
  const ratio = clamp01((progress - start) / (end - start))
  const opacity = 1 - ratio
  return {
    opacity,
    transform: `translateY(${-75 * ratio}px)`,
    filter: `blur(${ratio * 16}px)`,
    willChange: 'opacity, transform, filter',
    transition:
      'opacity 0.35s cubic-bezier(0.16,1,0.3,1), transform 0.35s cubic-bezier(0.16,1,0.3,1), filter 0.35s cubic-bezier(0.16,1,0.3,1)',
    pointerEvents: opacity < 0.15 ? 'none' : undefined,
  }
}

/** Обратное окно: элемент проявляется на [inStart, inEnd] и уходит на [outStart, outEnd]. */
function getRevealStyle(
  progress: number,
  inStart: number,
  inEnd: number,
  outStart: number,
  outEnd: number,
): CSSProperties {
  const appear = clamp01((progress - inStart) / (inEnd - inStart))
  const leave = clamp01((progress - outStart) / (outEnd - outStart))
  const ratio = progress < outStart ? 1 - appear : leave
  const opacity = 1 - ratio
  return {
    opacity,
    transform: `translateY(${(progress < outStart ? 40 : -40) * ratio}px)`,
    filter: `blur(${ratio * 12}px)`,
    willChange: 'opacity, transform, filter',
    transition: 'opacity 0.35s ease-out, transform 0.35s ease-out, filter 0.35s ease-out',
    pointerEvents: opacity < 0.15 ? 'none' : undefined,
  }
}

function scrubVideo(video: HTMLVideoElement | null, ratio: number) {
  if (!video || video.seeking) return
  const duration = video.duration
  if (!Number.isFinite(duration) || duration <= 0) return
  const target = clamp01(ratio) * duration
  const diff = target - video.currentTime
  if (Math.abs(diff) < 0.001) return
  video.currentTime += diff * LERP_VIDEO
}

/* ---------- Иконки ---------- */

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
    </svg>
  )
}

/* ---------- Приложение ---------- */

export default function App() {
  const route = useRoute()
  const content = useServerContent()
  useEffect(() => {
    document.title = {
      portfolio: 'Портфолио — VAAAAAAG',
      price: 'Прайс — VAAAAAAG',
      privacy: 'Политика конфиденциальности — VAAAAAAG',
      admin: 'Админка — VAAAAAAG',
      booking: 'Ваша заявка — VAAAAAAG',
      home: 'VAAAAAAG — фоткает',
    }[route.page]
  }, [route.page])

  let page
  if (route.page === 'portfolio') page = <PortfolioPage key={route.series} initialSeries={route.series} />
  else if (route.page === 'price') page = <PricePage />
  else if (route.page === 'privacy') page = <PrivacyPage />
  else if (route.page === 'booking') page = <BookingStatusPage token={route.token} />
  else if (route.page === 'admin')
    page = (
      <Suspense fallback={<div className="min-h-[100svh] bg-[#020202]" />}>
        <AdminPage api={API} />
      </Suspense>
    )
  else page = <Landing />
  return <ContentContext.Provider value={content}>{page}</ContentContext.Provider>
}

function Landing() {
  const { packages, series } = useContent()
  const PANELS = useMemo(() => buildPanels(packages), [packages])
  const heroList = series.length ? series : DEFAULT_SERIES
  const [progress, setProgress] = useState(0)
  const [dialog, setDialog] = useState<DialogState>(null)
  const closeDialog = useCallback(() => setDialog(null), [])

  // Карточка на первом экране листает серии; на наведении — пауза
  const [heroSeries, setHeroSeries] = useState(0)
  const heroPausedRef = useRef(false)
  useEffect(() => {
    if (heroList.length < 2) return
    const timer = window.setInterval(() => {
      if (!heroPausedRef.current) setHeroSeries((i) => (i + 1) % heroList.length)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [heroList.length])
  const hero = heroList[heroSeries % heroList.length]

  const targetScrollFractionRef = useRef(0)
  const currentScrollFractionRef = useRef(0)
  const video1Ref = useRef<HTMLVideoElement>(null)
  const video2Ref = useRef<HTMLVideoElement>(null)
  const rafRef = useRef(0)

  // Скролл → целевая доля
  useEffect(() => {
    const onScroll = () => {
      const max = stageScrollLength()
      targetScrollFractionRef.current = max > 0 ? clamp01(window.scrollY / max) : 0
    }
    onScroll()
    const timeout = window.setTimeout(onScroll, 500)
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.clearTimeout(timeout)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  // Цикл анимации: сглаживание прогресса и перемотка видео
  useEffect(() => {
    const tick = () => {
      const target = targetScrollFractionRef.current
      let current = currentScrollFractionRef.current
      current += (target - current) * LERP_SCROLL
      if (Math.abs(target - current) < 0.0005) current = target
      currentScrollFractionRef.current = current
      setProgress(current)

      let v1 = 0
      let v2 = 0
      if (current <= 0.4) {
        v1 = current / 0.4
      } else if (current <= 0.5) {
        v1 = 1
      } else if (current <= 0.9) {
        v1 = 1
        v2 = (current - 0.5) / 0.4
      } else {
        v1 = 1
        v2 = 1
      }
      scrubVideo(video1Ref.current, v1)
      scrubVideo(video2Ref.current, v2)

      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  /* --- Производные состояния --- */

  const firstVideoVisible = progress < 0.48
  const overlayHidden = progress >= 0.45

  const activePanelId: 1 | 2 | null =
    progress >= 0.9 ? 2 : progress >= 0.4 && progress <= 0.5 ? 1 : null
  const sheetOpen = activePanelId !== null

  // Пока шторка уезжает, держим в ней последний показанный контент
  const [shownPanelId, setShownPanelId] = useState<1 | 2>(1)
  if (activePanelId !== null && activePanelId !== shownPanelId) {
    setShownPanelId(activePanelId)
  }
  const panel = PANELS[shownPanelId]

  // Выбор пакета сбрасывается при смене панели
  const [selection, setSelection] = useState<{ panel: 1 | 2; index: number }>({ panel: 1, index: 0 })
  const selectedIndex = selection.panel === shownPanelId ? selection.index : 0
  const selectedPackage = panel.packages[selectedIndex]

  const s = (start: number, end: number) => getStaggerStyle(progress, start, end)

  return (
    <div className="relative bg-[#020202] font-sans text-white selection:bg-[#E8E6DC] selection:text-[#121212]">
      {/* ---------- Видео-сцена ---------- */}
      <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
        <video
          ref={video1Ref}
          muted
          playsInline
          preload="auto"
          className="absolute inset-0 h-full w-full object-cover transition-opacity duration-700"
          style={{ opacity: firstVideoVisible ? 0.85 : 0 }}
        >
          <source src={asset('video1.webm')} type="video/webm" />
          <source src={asset('video1.mp4')} type="video/mp4" />
        </video>
        <video
          ref={video2Ref}
          muted
          playsInline
          preload="auto"
          className="absolute inset-0 h-full w-full object-cover transition-opacity duration-700"
          style={{ opacity: firstVideoVisible ? 0 : 0.85 }}
        >
          <source src={asset('video2.webm')} type="video/webm" />
          <source src={asset('video2.mp4')} type="video/mp4" />
        </video>
        <div className="absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-[#020202] via-[#020202]/60 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-[#020202] via-[#020202]/70 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-[65%] bg-gradient-to-t from-[#020202]/85 via-[#020202]/45 to-transparent lg:hidden" />
        <div className="absolute inset-y-0 left-0 hidden w-1/2 bg-gradient-to-r from-[#020202]/90 via-[#020202]/40 to-transparent lg:block" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(2,2,2,0.65)_100%)]" />
        <div className="film-grain absolute -inset-[50%]" />
      </div>

      {/* ---------- Подсказка «листайте» ---------- */}
      <div
        className="pointer-events-none fixed right-4 top-1/2 z-10 hidden -translate-y-1/2 flex-col items-center gap-3 lg:flex"
        style={s(0, 0.04)}
        aria-hidden="true"
      >
        <span className="text-[9px] font-semibold uppercase tracking-[0.35em] text-white/40 [writing-mode:vertical-rl]">
          Листайте
        </span>
        <span className="scroll-cue relative h-14 w-px overflow-hidden bg-white/10" />
      </div>

      {/* ---------- Кнопка записи: всегда сверху справа ---------- */}
      <div className="fixed right-6 top-6 z-50 md:right-10 md:top-10 lg:right-12 lg:top-12">
        <BookButton onClick={() => setDialog({ section: 'booking' })} />
      </div>

      {/* ---------- Прогресс-бар ---------- */}
      <div
        className="fixed left-0 top-0 z-50 h-[2.5px]"
        style={{ width: `${progress * 100}%`, backgroundColor: ACCENT }}
        aria-hidden="true"
      />

      {/* ---------- Редакционный слой ---------- */}
      <div
        className={`fixed inset-0 z-10 flex flex-col justify-between p-6 md:p-10 lg:p-12 ${
          overlayHidden ? 'pointer-events-none invisible' : ''
        }`}
      >
        {/* Шапка */}
        <header className="flex items-start justify-between gap-6">
          <div className="max-w-[300px]">
            <div style={s(0, 0.12)}>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault()
                  scrollToFraction(0)
                }}
                aria-label="VAAAAAAG — наверх"
              >
                <img src={asset('logo.svg')} alt="VAAAAAAG" width={48} height={48} className="h-12 w-12" />
              </a>
            </div>
            <div className="mt-5" style={s(0.06, 0.18)}>
              <p className="font-serif text-lg leading-tight text-white/90 md:text-xl">
                Мрачная эстетика
                <br />
                <span className="italic text-white/60">для тех, кто не боится тишины</span>
              </p>
              <p className="mt-2 hidden max-w-[260px] text-[12px] leading-relaxed text-white/45 sm:block">
                Снимаю лес, воду, туман и тёмные образы. Фотографии, в которых есть настроение.
              </p>
            </div>
          </div>

          <nav className="flex items-center gap-5 lg:gap-7" style={s(0.03, 0.15)}>
            <ul className="hidden items-center gap-5 md:flex xl:gap-8">
              {NAV.map((item) => (
                <li key={item.label}>
                  <button
                    type="button"
                    onClick={() =>
                      item.target === 'contacts'
                        ? setDialog({ section: 'contacts' })
                        : item.target === 'portfolio'
                          ? openPortfolio()
                          : item.target === 'price'
                            ? openPrice()
                            : scrollToFraction(item.target)
                    }
                    className="group relative cursor-pointer whitespace-nowrap py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-white/70 transition-colors duration-300 hover:text-[#E8E6DC]"
                  >
                    {item.label}
                    <span className="absolute -bottom-0.5 left-0 h-px w-full origin-right scale-x-0 bg-[#E8E6DC] transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:origin-left group-hover:scale-x-100" />
                  </button>
                </li>
              ))}
            </ul>

            <span className="hidden h-5 w-px bg-white/15 md:block" aria-hidden="true" />

            <div className="flex items-center gap-4">
              <a
                href={INSTAGRAM}
                target="_blank"
                rel="noreferrer"
                aria-label="Instagram @vaag.ph"
                className="text-white/70 transition-colors duration-300 hover:text-[#E8E6DC]"
              >
                <InstagramIcon className="h-[18px] w-[18px]" />
              </a>
              <a
                href={TELEGRAM_CHANNEL}
                target="_blank"
                rel="noreferrer"
                aria-label="Telegram-канал t.me/Vaag_ph"
                className="text-white/70 transition-colors duration-300 hover:text-[#E8E6DC]"
              >
                <Send className="h-[17px] w-[17px]" strokeWidth={1.6} />
              </a>
            </div>

            {/* Место под кнопку записи: сама кнопка закреплена сверху и не исчезает при прокрутке */}
            <BookButton placeholder />
          </nav>
        </header>

        {/* Hero */}
        <main className="grid grid-cols-1 items-end gap-10 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-7">
            <h1
              className="hero-title mb-8 font-serif uppercase leading-[0.88] text-[#E8E6DC] lg:whitespace-nowrap"
              style={{ fontSize: 'clamp(2.5rem, 5.6vw, 7.5rem)' }}
            >
              <span className="block" style={s(0.09, 0.2)}>
                <span className="inline-block w-[1.6em]" aria-hidden="true" />
                <em className="italic">Снимаю</em>
              </span>
              <span className="block" style={s(0.12, 0.23)}>
                То, что ты
              </span>
              <span className="block" style={s(0.15, 0.26)}>
                Чувствуешь <em className="italic">в тишине</em>
              </span>
            </h1>

            <div className="grid max-w-[560px] gap-5 text-[12.5px] leading-relaxed text-white/55 sm:grid-cols-2">
              <p style={s(0.18, 0.29)}>
                Снимаю в Санкт-Петербурге и области: туманные леса Карельского перешейка, берега
                Финского залива, заброшенные усадьбы и пустые рассветные улицы.
              </p>
              <p style={s(0.21, 0.32)}>
                Каждая съёмка строится вокруг трёх вещей — настроения, локации и человека. Никаких
                шаблонных поз: только свет, тишина и то, что ты чувствуешь.
              </p>
            </div>
          </div>

          <aside className="hidden lg:col-span-5 lg:flex lg:justify-end">
            <div
              className="group w-full max-w-[240px]"
              onMouseEnter={() => (heroPausedRef.current = true)}
              onMouseLeave={() => (heroPausedRef.current = false)}
            >
              <div style={s(0.14, 0.25)}>
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/40">Серия</p>
                  {heroList.length > 1 && (
                    <div className="flex gap-1.5">
                      {heroList.map((x, i) => (
                        <button
                          key={x.id}
                          type="button"
                          onClick={() => setHeroSeries(i)}
                          aria-label={`Показать серию «${x.title}»`}
                          aria-current={i === heroSeries % heroList.length}
                          className="group/dot flex h-4 cursor-pointer items-center"
                        >
                          <span
                            className={`block h-px transition-all duration-500 ${
                              i === heroSeries % heroList.length ? 'w-6 bg-[#E8E6DC]' : 'w-3 bg-white/25 group-hover/dot:bg-white/60'
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="relative mt-1 min-h-[96px]">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={hero.id}
                      initial={{ opacity: 0, y: 8, filter: 'blur(6px)' }}
                      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                      exit={{ opacity: 0, y: -8, filter: 'blur(6px)' }}
                      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                    >
                      <p className="font-serif text-2xl italic text-white/90">{hero.title}</p>
                      <p className="mt-2 text-[11.5px] leading-relaxed text-white/45">{hero.description}</p>
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>

              <div className="mt-3" style={s(0.18, 0.29)}>
                <button
                  type="button"
                  onClick={() => openPortfolio(hero.id)}
                  className="hero-card relative block aspect-[4/5] w-full cursor-pointer overflow-hidden rounded-sm border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.01] p-3 transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-[1.04]"
                  aria-label={`Открыть серию «${hero.title}» в портфолио`}
                >
                  <span className="relative block h-full w-full overflow-hidden">
                    <AnimatePresence initial={false}>
                      <motion.img
                        key={hero.id}
                        src={hero.photos[0].srcSm}
                        alt={hero.photos[0].alt}
                        className="absolute inset-0 h-full w-full object-cover object-top"
                        initial={{ opacity: 0, scale: 1.06 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
                      />
                    </AnimatePresence>
                  </span>
                  <ArrowUpRight
                    className="absolute right-3 top-3 h-4 w-4 text-white/50 transition-colors duration-300 group-hover:text-[#E8E6DC]"
                    strokeWidth={1.5}
                  />
                </button>
              </div>

              <p
                className="mt-4 font-serif text-2xl text-white transition-colors duration-500 group-hover:text-[#E8E6DC]"
                style={s(0.2, 0.31)}
              >
                от {formatPrice(Math.min(...packages.map((p) => p.price)))}
              </p>
            </div>
          </aside>
        </main>
      </div>

      {/* ---------- Обо мне (между сериями) ---------- */}
      <section
        className="pointer-events-none fixed inset-0 z-10 flex items-end justify-end p-6 md:p-10 lg:p-12"
        style={{ visibility: progress > 0.52 && progress < 0.9 ? 'visible' : 'hidden' }}
        aria-label="Обо мне"
      >
        <div className="max-w-[460px] text-right" style={getRevealStyle(progress, 0.55, 0.65, 0.78, 0.88)}>
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/40">Обо мне</p>
          <p className="mt-3 font-serif text-3xl leading-[1.05] text-[#E8E6DC] md:text-4xl">
            {ABOUT.title}
            <br />
            <em className="italic">{ABOUT.titleAccent}</em>
          </p>
          <p className="mt-4 text-[12.5px] leading-relaxed text-white/55">{ABOUT.paragraphs[0]}</p>
        </div>
      </section>

      {/* ---------- Выезжающая шторка ---------- */}
      <aside
        className={`fixed left-0 top-0 z-30 flex h-full w-full flex-col bg-[#FAF9F5] text-[#121212] shadow-[30px_0_80px_rgba(0,0,0,0.45)] transition-transform duration-[1100ms] ease-[cubic-bezier(0.16,1,0.3,1)] sm:w-[600px] lg:w-[648px] ${
          sheetOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-hidden={!sheetOpen}
        inert={!sheetOpen}
      >
        <button
          type="button"
          onClick={() => scrollToFraction(progress >= 0.9 ? 0.82 : 0.35)}
          className="group absolute left-6 top-6 z-10 flex cursor-pointer items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#73716C] transition-colors duration-300 hover:text-[#121212] md:left-8 md:top-8"
        >
          <ArrowLeft
            className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-x-1"
            strokeWidth={1.6}
          />
          К сериям
        </button>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6 pt-20 md:px-10 md:pt-20">
          <AnimatePresence mode="wait">
            <motion.div
              key={panel.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              className="flex min-h-full flex-col"
            >
              {/* Заголовок */}
              <header className="mx-auto max-w-[440px] text-center">
                <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-[#8E8B84]">
                  {panel.category}
                </p>
                <h2 className="mt-3 font-serif text-[2.1rem] leading-[1.02] md:text-[2.6rem]">
                  {panel.title}
                </h2>
                <p className="mx-auto mt-3 max-w-[380px] text-[12px] leading-relaxed text-[#73716C]">
                  {panel.description}
                </p>
              </header>

              {/* Фото */}
              <div className="relative mt-6 min-h-[180px] flex-1 overflow-hidden rounded-sm bg-[#E5E5E2]">
                <img
                  src={panel.image}
                  alt={panel.category}
                  className="absolute inset-0 h-full w-full object-cover object-[50%_25%]"
                />
              </div>

              {/* Что входит */}
              <ul className="mt-5 grid grid-cols-1 gap-x-6 gap-y-1.5 text-[11.5px] text-[#73716C] sm:grid-cols-2">
                {selectedPackage.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span className="mt-[7px] h-px w-3 shrink-0 bg-[#8E8B84]" aria-hidden="true" />
                    {f}
                  </li>
                ))}
              </ul>

              {/* Подвал: выбор пакета + бронь */}
              <div className="mt-5 flex flex-col gap-4 border-t border-[#E5E5E2] pt-5 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div
                    className="inline-flex rounded-full border border-[#E5E5E2] p-1"
                    role="radiogroup"
                    aria-label="Пакет"
                  >
                    {panel.packages.map((pkg, i) => {
                      const active = i === selectedIndex
                      return (
                        <button
                          key={pkg.name}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => setSelection({ panel: panel.id, index: i })}
                          className={`relative cursor-pointer rounded-full px-3.5 py-1.5 text-[11px] font-medium transition-colors duration-300 ${
                            active ? 'text-[#FAF9F5]' : 'text-[#73716C] hover:text-[#121212]'
                          }`}
                        >
                          {active && (
                            <motion.span
                              layoutId={`pkg-pill-${panel.id}`}
                              className="absolute inset-0 rounded-full bg-[#121212]"
                              transition={{ type: 'spring', stiffness: 400, damping: 34 }}
                            />
                          )}
                          <span className="relative">{pkg.name}</span>
                        </button>
                      )
                    })}
                  </div>
                  <div className="mt-3 flex items-baseline gap-3 pl-1">
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span
                        key={`${panel.id}-${selectedIndex}`}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.25 }}
                        className="flex items-baseline gap-3"
                      >
                        <span className="font-serif text-3xl leading-none">
                          {formatPrice(selectedPackage.price)}
                        </span>
                        <span className="text-[11px] uppercase tracking-[0.18em] text-[#8E8B84]">
                          {packageSummary(selectedPackage)}
                        </span>
                      </motion.span>
                    </AnimatePresence>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setDialog({ section: 'booking', packageId: selectedPackage.id })}
                  aria-haspopup="dialog"
                  className="group inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[#121212] px-6 py-3.5 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-[#FAF9F5] transition-colors duration-300 hover:bg-[#2a2a28]"
                >
                  Забронировать съёмку
                  <ArrowUpRight
                    className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                    strokeWidth={1.8}
                  />
                </button>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </aside>

      {/* Длина сцены: прокрутка по ней управляет видео и панелями */}
      <div id="stage" className="h-[650vh]" aria-hidden="true" />

      <ContactsSection />

      <AnimatePresence>
        {dialog && <ContactsSection dialog {...dialog} onClose={closeDialog} />}
      </AnimatePresence>
    </div>
  )
}

/* ---------- Шапка и подвал отдельных страниц ---------- */

function SubPageHeader({ current, onDialog }: { current?: 'portfolio' | 'price'; onDialog: (d: DialogState) => void }) {
  const navLink =
    'group relative cursor-pointer whitespace-nowrap py-1 text-[11px] font-medium uppercase tracking-[0.2em] transition-colors duration-300'
  const underline =
    'absolute -bottom-0.5 left-0 h-px w-full bg-[#E8E6DC] transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]'
  const items = [
    { id: 'portfolio' as const, label: 'Портфолио', go: () => openPortfolio() },
    { id: 'price' as const, label: 'Прайс', go: openPrice },
  ]

  return (
    <header className="flex items-center justify-between gap-6 p-6 md:p-10 lg:p-12">
      <div className="flex items-center gap-6">
        <button type="button" onClick={goHome} aria-label="VAAAAAAG — на главную" className="cursor-pointer">
          <img src={asset('logo.svg')} alt="" width={48} height={48} className="h-12 w-12" />
        </button>
        <button
          type="button"
          onClick={goHome}
          className="group hidden cursor-pointer items-center gap-2 whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.22em] text-white/50 transition-colors duration-300 hover:text-[#E8E6DC] lg:flex"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-x-1" strokeWidth={1.6} />
          На главную
        </button>
      </div>

      <nav className="flex items-center gap-5 lg:gap-7">
        <ul className="hidden items-center gap-5 md:flex xl:gap-8">
          {items.map((item) =>
            item.id === current ? (
              <li key={item.id}>
                <span className={`${navLink} cursor-default text-[#E8E6DC]`} aria-current="page">
                  {item.label}
                  <span className={`${underline} scale-x-100`} />
                </span>
              </li>
            ) : (
              <li key={item.id}>
                <button type="button" onClick={item.go} className={`${navLink} text-white/70 hover:text-[#E8E6DC]`}>
                  {item.label}
                  <span className={`${underline} origin-right scale-x-0 group-hover:origin-left group-hover:scale-x-100`} />
                </button>
              </li>
            ),
          )}
          <li>
            <button type="button" onClick={() => onDialog({ section: 'about' })} className={`${navLink} text-white/70 hover:text-[#E8E6DC]`}>
              Обо мне
              <span className={`${underline} origin-right scale-x-0 group-hover:origin-left group-hover:scale-x-100`} />
            </button>
          </li>
        </ul>
        <span className="hidden h-5 w-px bg-white/15 md:block" aria-hidden="true" />
        <div className="flex items-center gap-4">
          <a href={INSTAGRAM} target="_blank" rel="noreferrer" aria-label="Instagram @vaag.ph" className="text-white/70 transition-colors duration-300 hover:text-[#E8E6DC]">
            <InstagramIcon className="h-[18px] w-[18px]" />
          </a>
          <a href={TELEGRAM_CHANNEL} target="_blank" rel="noreferrer" aria-label="Telegram-канал t.me/Vaag_ph" className="text-white/70 transition-colors duration-300 hover:text-[#E8E6DC]">
            <Send className="h-[17px] w-[17px]" strokeWidth={1.6} />
          </a>
        </div>
        <BookButton onClick={() => onDialog({ section: 'booking' })} />
      </nav>
    </header>
  )
}

function SubPageFooter() {
  return (
    <footer className="flex flex-col gap-2 border-t border-white/10 p-6 text-[11px] text-white/35 sm:flex-row sm:justify-between md:px-10 lg:px-12">
      <span>© {new Date().getFullYear()} VAAAAAAG — фоткает</span>
      <a href="#privacy" className="underline-offset-4 hover:text-[#E8E6DC] hover:underline">
        Политика конфиденциальности
      </a>
      <span>Санкт-Петербург и область</span>
    </footer>
  )
}

/* ---------- Прайс: отдельная страница ----------
 * Пакеты и цены — в shared/booking.ts (их же использует запись). Здесь — то, что записи не касается. */

const EVENTS = {
  title: 'Свадьбы и события',
  kinds: 'Свадьбы, дни рождения, семейные праздники, выпускные, крещения, корпоративы.',
  features: [
    'Репортаж без постановок: живые эмоции и детали',
    'Формат, время и место зависят от события',
    'Авторская обработка и доступ к фото на облачном диске',
  ],
  price: 'по договорённости',
  note: 'Обсуждаем в личных сообщениях: задачи, место и количество гостей.',
}

const DISCOUNTS = {
  lead: 'Возвращаетесь на съёмку: благодарю скидкой на следующую.',
  rows: [
    { label: 'Вторая съёмка', value: '−5%' },
    { label: 'Третья съёмка и далее', value: '−10%' },
  ],
  note: 'Скидка не суммируется с акциями и спецпредложениями.',
}

/** Частые вопросы. Вопрос без ответа на сайте не показывается — допишите `a`, и он появится. */
const FAQ: { q: string; a?: string }[] = [
  {
    q: 'Как подготовиться к съёмке и что надеть?',
    a: 'Перед съёмкой мы переписываемся: обсуждаем идею, образ, одежду и место. Консультация по подготовке, подбор мест и маршрут входят в Стандартный и Максимальный пакеты.',
  },
  {
    q: 'Где проходят съёмки?',
    a: 'В Санкт-Петербурге и области: лес, вода, город — под настроение, которое хочется передать. Подберу места и составлю маршрут.',
  },
  {
    q: 'Как я получу фотографии?',
    a: 'Обработанные фото — в закрытой папке на облачном диске. В Максимальном пакете дополнительно отдаю флешку со всеми обработанными фото.',
  },
  {
    q: 'Снимаете свадьбы, дни рождения, корпоративы?',
    a: 'Да, в формате репортажа. Стоимость по договорённости — зависит от задачи, места и количества гостей. Напишите мне в Telegram.',
  },
  {
    q: 'Есть ли скидки?',
    a: 'Постоянным клиентам: −5% на вторую съёмку и −10% на третью и дальше. Скидка не суммируется с акциями.',
  },
  // ↓ Ответы нужны от автора — пока эти вопросы на сайте не видны
  { q: 'Через сколько дней будут готовы фото?' },
  { q: 'Нужна ли предоплата?' },
  { q: 'Что если нужно перенести съёмку или пойдёт дождь?' },
  { q: 'Есть ли доплата за выезд за город?' },
]

function PricePage() {
  const { packages } = useContent()
  const [dialog, setDialog] = useState<DialogState>(null)
  const closeDialog = useCallback(() => setDialog(null), [])
  const eyebrow = 'text-[10px] font-semibold uppercase tracking-[0.25em] text-white/40'
  const rule = <span className="mt-6 block h-px w-14 bg-white/25" aria-hidden="true" />

  return (
    <div className="min-h-[100svh] bg-[#020202] font-sans text-white selection:bg-[#E8E6DC] selection:text-[#121212]">
      <SubPageHeader current="price" onDialog={setDialog} />

      <main className="flex flex-col gap-24 px-6 pb-24 pt-6 md:px-10 lg:px-12 lg:pt-10">
        {/* Сводка, как в прайсе автора */}
        <section aria-labelledby="price-title" className="grid grid-cols-1 gap-12 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <p className={eyebrow}>Фотосъёмки · Санкт-Петербург и область</p>
            <h1
              id="price-title"
              className="mt-5 font-serif uppercase leading-[0.9] text-[#E8E6DC]"
              style={{ fontSize: 'clamp(2.5rem, 5.6vw, 7.5rem)' }}
            >
              Прайс
            </h1>
            {rule}
          </div>
          <ol className="flex flex-col divide-y divide-white/10 border-y border-white/10 lg:col-span-7 lg:self-end">
            {[...packages.map((p) => ({ id: p.id, name: p.name, sub: p.duration, price: formatPrice(p.price) })), {
              id: 'events',
              name: 'Свадебный',
              sub: 'свадьбы и события',
              price: EVENTS.price,
            }].map((row, i) => (
              <li key={row.id}>
                <a href={`#price-${row.id}`} onClick={(e) => {
                  e.preventDefault()
                  document.getElementById(`price-${row.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }} className="group grid grid-cols-[2.5rem_1fr_auto] items-baseline gap-x-4 py-5 transition-colors">
                  <span className="text-[11px] tabular-nums text-white/35">{String(i + 1).padStart(2, '0')}</span>
                  <span>
                    <span className="block font-serif text-2xl text-white/90 transition-colors duration-300 group-hover:text-[#E8E6DC] md:text-3xl">{row.name}</span>
                    <span className="mt-1 block text-[12px] text-white/40">{row.sub}</span>
                  </span>
                  <span className={`font-serif text-right ${row.id === 'events' ? 'text-base text-white/60 md:text-lg' : 'text-2xl text-[#E8E6DC] md:text-3xl'}`}>
                    {row.price}
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </section>

        {/* Пакеты подробно */}
        <section aria-label="Пакеты" className="grid grid-cols-1 gap-px overflow-hidden rounded-sm border border-white/10 bg-white/10 lg:grid-cols-3">
          {packages.map((p, i) => (
            <article key={p.id} id={`price-${p.id}`} className="flex scroll-mt-8 flex-col bg-[#020202] p-6 md:p-8">
              <p className={eyebrow}>
                Пакет {i + 1} · {p.duration}
              </p>
              <h2 className="mt-4 font-serif text-4xl leading-none text-white md:text-5xl">{p.name}</h2>
              {rule}
              {p.tagline && <p className="mt-6 text-[14px] leading-relaxed text-white/55">{p.tagline}</p>}
              <ul className="mt-6 flex flex-col gap-2.5 text-[14px] leading-snug text-white/80">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-3">
                    <span className="text-white/35" aria-hidden="true">—</span>
                    {f}
                  </li>
                ))}
              </ul>
              <div className="mt-auto pt-10">
                <p className="font-serif text-5xl leading-none text-[#E8E6DC]">{formatPrice(p.price)}</p>
                {p.note && <p className="mt-3 text-[12px] leading-relaxed text-white/40">{p.note}</p>}
                <button
                  type="button"
                  onClick={() => setDialog({ section: 'booking', packageId: p.id })}
                  aria-haspopup="dialog"
                  className="group mt-6 inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/20 px-5 py-3 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-white transition-colors duration-300 hover:border-[#E8E6DC] hover:bg-[#E8E6DC] hover:text-[#121212]"
                >
                  Записаться
                  <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" strokeWidth={1.8} />
                </button>
              </div>
            </article>
          ))}
        </section>

        {/* Свадьбы и события + скидки */}
        <div className="grid grid-cols-1 gap-16 lg:grid-cols-12 lg:gap-8">
          <section id="price-events" aria-labelledby="events-title" className="scroll-mt-8 lg:col-span-7">
            <p className={eyebrow}>Пакет {packages.length + 1} · Другие события</p>
            <h2 id="events-title" className="mt-4 font-serif text-4xl leading-none text-white md:text-5xl">
              {EVENTS.title}
            </h2>
            {rule}
            <p className="mt-6 max-w-[520px] text-[14px] leading-relaxed text-white/55">{EVENTS.kinds}</p>
            <ul className="mt-6 flex max-w-[560px] flex-col gap-2.5 text-[14px] leading-snug text-white/80">
              {EVENTS.features.map((f) => (
                <li key={f} className="flex gap-3">
                  <span className="text-white/35" aria-hidden="true">—</span>
                  {f}
                </li>
              ))}
            </ul>
            <p className="mt-10 font-serif text-4xl leading-none text-[#E8E6DC]">{EVENTS.price}</p>
            <p className="mt-3 max-w-[460px] text-[12px] leading-relaxed text-white/40">{EVENTS.note}</p>
            <a
              href={TELEGRAM_PERSONAL}
              target="_blank"
              rel="noreferrer"
              className="group mt-6 inline-flex items-center gap-2 rounded-full border border-white/20 px-5 py-3 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-white transition-colors duration-300 hover:border-[#E8E6DC] hover:bg-[#E8E6DC] hover:text-[#121212]"
            >
              Обсудить в Telegram
              <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" strokeWidth={1.8} />
            </a>
          </section>

          <section aria-labelledby="discounts-title" className="lg:col-span-5">
            <p className={eyebrow}>Постоянным клиентам</p>
            <h2 id="discounts-title" className="mt-4 font-serif text-4xl leading-none text-white md:text-5xl">
              Скидки
            </h2>
            {rule}
            <p className="mt-6 text-[14px] leading-relaxed text-white/55">{DISCOUNTS.lead}</p>
            <dl className="mt-6 divide-y divide-white/10 border-y border-white/10">
              {DISCOUNTS.rows.map((r) => (
                <div key={r.label} className="flex items-baseline justify-between py-4">
                  <dt className="text-[14px] text-white/80">{r.label}</dt>
                  <dd className="font-serif text-3xl tabular-nums text-[#E8E6DC]">{r.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-[12px] leading-relaxed text-white/40">{DISCOUNTS.note}</p>
          </section>
        </div>

        {/* Частые вопросы */}
        <section aria-labelledby="faq-title" className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-5">
            <p className={eyebrow}>Перед записью</p>
            <h2 id="faq-title" className="mt-4 font-serif text-4xl leading-none text-white md:text-5xl">
              Частые вопросы
            </h2>
            {rule}
          </div>
          <div className="divide-y divide-white/10 border-y border-white/10 lg:col-span-7">
            {FAQ.filter((f) => f.a).map((f) => (
              <details key={f.q} className="group py-1">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-4 text-[15px] text-white/85 transition-colors hover:text-[#E8E6DC] [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span className="relative h-3 w-3 shrink-0" aria-hidden="true">
                    <span className="absolute left-0 top-1/2 h-px w-3 bg-current" />
                    <span className="absolute left-1/2 top-0 h-3 w-px bg-current transition-transform duration-300 group-open:scale-y-0" />
                  </span>
                </summary>
                <p className="max-w-[620px] pb-5 text-[14px] leading-relaxed text-white/55">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <SubPageFooter />

      <AnimatePresence>
        {dialog && <ContactsSection dialog {...dialog} onClose={closeDialog} />}
      </AnimatePresence>
    </div>
  )
}

/* ---------- Политика конфиденциальности ----------
 * Два варианта текста: для сайта с сервером (заявки хранятся в базе) и для сайта без сервера
 * (GitHub Pages: форма только составляет текст, данные никуда не уходят).
 * Статус (самозанятый / ИП, ИНН) и почту можно дописать в PRIVACY_OPERATOR — пустые поля не показываются.
 * Если подключите аналитику (Яндекс Метрику) — добавьте про cookies в раздел 8. */

const PRIVACY_OPERATOR = {
  name: 'Малхасян Ваагн Мурадович',
  status: '',
  email: '',
  telegram: '@vaaaaaag',
  site: SITE_HOST,
  edition: '26 октября 2026 г.',
}

function PrivacyPage() {
  const [dialog, setDialog] = useState<DialogState>(null)
  const closeDialog = useCallback(() => setDialog(null), [])
  const o = PRIVACY_OPERATOR
  const withServer = API !== null
  const operator = [o.name, o.status, o.email && `e-mail: ${o.email}`, `Telegram: ${o.telegram}`].filter(Boolean).join(', ')
  const contact = o.email ? `на ${o.email} или в Telegram ${o.telegram}` : `в Telegram ${o.telegram}`

  const sections: { title: string; body: (string | string[])[] }[] = [
    {
      title: '1. Общие положения',
      body: [
        `Эта политика описывает, как обрабатываются персональные данные посетителей сайта ${o.site}. Оператор персональных данных — ${operator}.`,
        'Политика составлена в соответствии с Федеральным законом от 27.07.2006 № 152-ФЗ «О персональных данных».',
      ],
    },
    withServer
      ? {
          title: '2. Какие данные я получаю',
          body: [
            'Только то, что вы сами указываете в форме записи:',
            ['имя;', 'Telegram или номер телефона;', 'комментарий к заявке (по желанию);', 'выбранные пакет, дату и время съёмки.'],
            'Для защиты от спама сохраняется необратимый отпечаток (хеш) IP-адреса — сам адрес не хранится.',
          ],
        }
      : {
          title: '2. Какие данные я получаю',
          body: [
            'Сайт сам не собирает и не хранит персональные данные. Форма записи только составляет текст заявки прямо на вашем устройстве и никуда его не отправляет.',
            'Данные я получаю, только если вы сами отправите мне этот текст или напишете в Telegram:',
            ['имя;', 'Telegram или номер телефона;', 'комментарий к заявке (по желанию);', 'выбранные пакет, дату и время съёмки.'],
          ],
        },
    {
      title: '3. Зачем',
      body: [['чтобы договориться о съёмке и закрепить за вами время;', 'чтобы связаться с вами, подтвердить и обсудить съёмку;', 'чтобы провести съёмку и передать фотографии.']],
    },
    {
      title: '4. Основание',
      body: [
        withServer
          ? 'Ваше согласие, которое вы даёте, отмечая галочку в форме записи. Без согласия заявку отправить нельзя.'
          : 'Ваше согласие: вы сами решаете, отправлять ли мне заявку, и отмечаете согласие в форме записи.',
      ],
    },
    withServer
      ? {
          title: '5. Как хранятся и кому передаются данные',
          body: [
            'Заявки хранятся в базе данных на сервере сайта в России. Данные не продаются и не передаются третьим лицам.',
            'Уведомление о заявке приходит мне в Telegram, а если вы сами подпишетесь на бота — вам. Серверы Telegram могут находиться за пределами России; отмечая согласие, вы соглашаетесь и на такую (трансграничную) передачу.',
          ],
        }
      : {
          title: '5. Как хранятся и кому передаются данные',
          body: [
            'Переписка о съёмке хранится в Telegram. Данные не продаются и не передаются третьим лицам.',
            'Серверы Telegram могут находиться за пределами России; отправляя заявку, вы соглашаетесь и на такую (трансграничную) передачу.',
            'Сайт размещён на GitHub Pages. Как и любой хостинг, GitHub может вести технические журналы посещений (например, IP-адреса); у меня к ним доступа нет.',
          ],
        },
    {
      title: '6. Сколько хранятся',
      body: ['Не дольше, чем нужно для целей из раздела 3, и не более одного года после даты съёмки. Если вы отзовёте согласие — данные будут удалены в течение 30 дней.'],
    },
    {
      title: '7. Ваши права',
      body: [
        `Вы можете узнать, какие ваши данные у меня есть, попросить исправить или удалить их и отозвать согласие. Для этого напишите ${contact}. Отвечу в течение 10 рабочих дней.`,
      ],
    },
    {
      title: '8. Cookies и аналитика',
      body: ['Сайт не использует cookies и сервисы аналитики для посетителей.'],
    },
    {
      title: '9. Изменения',
      body: [`Политика может обновляться; актуальная версия всегда на этой странице. Редакция от ${o.edition}`],
    },
  ]

  return (
    <div className="min-h-[100svh] bg-[#020202] font-sans text-white selection:bg-[#E8E6DC] selection:text-[#121212]">
      <SubPageHeader onDialog={setDialog} />
      <main className="px-6 pb-24 pt-6 md:px-10 lg:px-12 lg:pt-10">
        <div className="max-w-[720px]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/40">Документы</p>
          <h1 className="mt-5 font-serif text-5xl leading-[0.95] text-[#E8E6DC] md:text-6xl">Политика конфиденциальности</h1>
          <span className="mt-6 block h-px w-14 bg-white/25" aria-hidden="true" />
          <div className="mt-10 flex flex-col gap-10">
            {sections.map((sec) => (
              <section key={sec.title}>
                <h2 className="font-serif text-2xl text-white/90">{sec.title}</h2>
                <div className="mt-3 flex flex-col gap-3 text-[14.5px] leading-relaxed text-white/65">
                  {sec.body.map((part, i) =>
                    Array.isArray(part) ? (
                      <ul key={i} className="flex flex-col gap-1.5">
                        {part.map((li) => (
                          <li key={li} className="flex gap-3">
                            <span className="text-white/35" aria-hidden="true">—</span>
                            {li}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p key={i}>{part}</p>
                    ),
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>
      </main>
      <SubPageFooter />
      <AnimatePresence>
        {dialog && <ContactsSection dialog {...dialog} onClose={closeDialog} />}
      </AnimatePresence>
    </div>
  )
}

/* ---------- Статус заявки для клиента ---------- */

type BookingStatus = {
  status: 'new' | 'confirmed' | 'cancelled'
  packageName: string
  packagePrice: number
  date: string
  time: string
  name: string
  subscribed: boolean
  telegramBot: string | null
}

const STATUS_VIEW: Record<BookingStatus['status'], { label: string; text: string; tone: string }> = {
  new: {
    label: 'Ждёт подтверждения',
    text: 'Заявка у меня. Я посмотрю её и подтвержу съёмку или напишу вам, если что-то нужно уточнить.',
    tone: 'border-white/25 text-white/80',
  },
  confirmed: {
    label: 'Съёмка подтверждена',
    text: 'До встречи! Если планы изменятся — напишите мне в Telegram.',
    tone: 'border-[#E8E6DC] bg-[#E8E6DC] text-[#121212]',
  },
  cancelled: {
    label: 'Заявка отменена',
    text: 'Если это ошибка или хотите выбрать другое время — напишите мне или запишитесь снова.',
    tone: 'border-white/15 text-white/45 line-through decoration-white/30',
  },
}

function BookingStatusPage({ token }: { token: string }) {
  const [dialog, setDialog] = useState<DialogState>(null)
  const closeDialog = useCallback(() => setDialog(null), [])
  const [state, setState] = useState<{ status: 'loading' } | { status: 'ok'; data: BookingStatus } | { status: 'error'; message: string }>(
    { status: 'loading' },
  )

  useEffect(() => {
    if (!API) {
      setState({ status: 'error', message: 'Статус заявки доступен только на работающем сайте.' })
      return
    }
    fetch(`${API}/bookings/${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (r.ok) return setState({ status: 'ok', data: await r.json() })
        setState({ status: 'error', message: r.status === 404 ? 'Заявка не найдена. Проверьте ссылку.' : 'Не удалось загрузить заявку.' })
      })
      .catch(() => setState({ status: 'error', message: 'Нет связи с сервером. Попробуйте позже.' }))
  }, [token])

  return (
    <div className="min-h-[100svh] bg-[#020202] font-sans text-white selection:bg-[#E8E6DC] selection:text-[#121212]">
      <SubPageHeader onDialog={setDialog} />
      <main className="px-6 pb-24 pt-6 md:px-10 lg:px-12 lg:pt-10">
        <div className="max-w-[640px]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/40">Запись на съёмку</p>
          <h1 className="mt-5 font-serif text-5xl leading-[0.95] text-[#E8E6DC] md:text-6xl">Ваша заявка</h1>
          <span className="mt-6 block h-px w-14 bg-white/25" aria-hidden="true" />

          {state.status === 'loading' && <p className="mt-10 text-[14px] text-white/45">Загружаю…</p>}
          {state.status === 'error' && <p className="mt-10 text-[14px] text-white/65">{state.message}</p>}
          {state.status === 'ok' && (
            <div className="mt-10 flex flex-col gap-8" aria-live="polite">
              <span className={`self-start rounded-full border px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] ${STATUS_VIEW[state.data.status].tone}`}>
                {STATUS_VIEW[state.data.status].label}
              </span>
              <dl className="divide-y divide-white/10 border-y border-white/10 text-[14px]">
                {[
                  ['Имя', state.data.name],
                  ['Пакет', `${state.data.packageName} · ${formatPrice(state.data.packagePrice)}`],
                  ['Дата', formatDateRu(state.data.date, true)],
                  ['Время', `${state.data.time} (по Петербургу)`],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-6 py-4">
                    <dt className="text-white/45">{k}</dt>
                    <dd className="text-right text-white/90">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-[14px] leading-relaxed text-white/60">{STATUS_VIEW[state.data.status].text}</p>
              <div className="flex flex-wrap gap-3">
                {state.data.telegramBot && !state.data.subscribed && state.data.status !== 'cancelled' && (
                  <a
                    href={`https://t.me/${state.data.telegramBot}?start=b_${token}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-full bg-[#E8E6DC] px-6 py-3 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-[#121212] transition-colors duration-300 hover:bg-white"
                  >
                    <Send className="h-3.5 w-3.5" strokeWidth={1.8} />
                    Уведомления в Telegram
                  </a>
                )}
                {state.data.subscribed && (
                  <span className="inline-flex items-center gap-2 text-[12.5px] text-white/55">
                    <Check className="h-4 w-4" strokeWidth={2} /> Уведомления в Telegram включены
                  </span>
                )}
                <a
                  href={TELEGRAM_PERSONAL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-3 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-white transition-colors duration-300 hover:border-[#E8E6DC] hover:text-[#E8E6DC]"
                >
                  Написать @vaaaaaag
                  <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.8} />
                </a>
              </div>
            </div>
          )}
        </div>
      </main>
      <SubPageFooter />
      <AnimatePresence>
        {dialog && <ContactsSection dialog {...dialog} onClose={closeDialog} />}
      </AnimatePresence>
    </div>
  )
}

/* ---------- Портфолио: отдельная страница ---------- */

function PortfolioPage({ initialSeries }: { initialSeries: string }) {
  const [filter, setFilter] = useState(initialSeries)
  const [lightbox, setLightbox] = useState<{ shots: Shot[]; index: number } | null>(null)
  const closeLightbox = useCallback(() => setLightbox(null), [])
  const [dialog, setDialog] = useState<DialogState>(null)
  const closeDialog = useCallback(() => setDialog(null), [])

  return (
    <div className="min-h-[100svh] bg-[#020202] font-sans text-white selection:bg-[#E8E6DC] selection:text-[#121212]">
      <SubPageHeader current="portfolio" onDialog={setDialog} />

      <main>
        <PortfolioSection filter={filter} onFilter={setFilter} onOpen={(shots, index) => setLightbox({ shots, index })} />
      </main>

      <SubPageFooter />

      <AnimatePresence>
        {lightbox && (
          <Lightbox
            shots={lightbox.shots}
            index={lightbox.index}
            onIndex={(index) => setLightbox((l) => (l ? { ...l, index } : l))}
            onClose={closeLightbox}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {dialog && <ContactsSection dialog {...dialog} onClose={closeDialog} />}
      </AnimatePresence>
    </div>
  )
}

function PortfolioSection({
  filter,
  onFilter,
  onOpen,
}: {
  filter: string
  onFilter: (id: string) => void
  onOpen: (shots: Shot[], index: number) => void
}) {
  const { series: SERIES } = useContent()
  // Серия из ссылки могла исчезнуть — тогда показываем всё
  if (filter !== 'all' && !SERIES.some((x) => x.id === filter)) filter = 'all'
  const shots = shotsOf(SERIES, filter)
  const current = SERIES.find((x) => x.id === filter)
  const tabs = [{ id: 'all', title: 'Все' }, ...SERIES]

  return (
    <section className="px-6 pb-16 pt-6 md:px-10 lg:px-12 lg:pt-10" aria-labelledby="portfolio-title">
      <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/40">Серии</p>
          <h1
            id="portfolio-title"
            className="mt-5 font-serif uppercase leading-[0.9] text-[#E8E6DC]"
            style={{ fontSize: 'clamp(2.5rem, 5.6vw, 7.5rem)' }}
          >
            Портфолио
          </h1>
        </div>

        <div className="flex flex-col gap-4 lg:items-end">
          {SERIES.length > 1 && (
            <div className="flex flex-wrap gap-1 rounded-full border border-white/10 p-1" role="tablist" aria-label="Серии">
              {tabs.map((t) => {
                const active = t.id === filter
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => onFilter(t.id)}
                    className={`relative cursor-pointer rounded-full px-4 py-2 text-[11px] font-medium transition-colors duration-300 ${
                      active ? 'text-[#121212]' : 'text-white/60 hover:text-[#E8E6DC]'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="portfolio-tab"
                        className="absolute inset-0 rounded-full bg-[#E8E6DC]"
                        transition={{ type: 'spring', stiffness: 400, damping: 34 }}
                      />
                    )}
                    <span className="relative">{t.title}</span>
                  </button>
                )
              })}
            </div>
          )}
          <p className="min-h-[1.5em] max-w-[420px] text-[12.5px] leading-relaxed text-white/45 lg:text-right">
            {SERIES.length === 1
              ? `${SERIES[0].title} · ${SERIES[0].description} · ${shotsOf(SERIES, 'all').length} фото`
              : current
                ? current.description
                : `${plural(SERIES.length, 'серия', 'серии', 'серий')} · ${shotsOf(SERIES, 'all').length} фото`}
          </p>
        </div>
      </div>

      <motion.div
        key={filter}
        className="mt-12 columns-1 gap-4 sm:columns-2 lg:columns-3"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        {shots.map((shot, i) => (
          <button
            key={shot.id}
            type="button"
            onClick={() => onOpen(shots, i)}
            className="group relative mb-4 block w-full cursor-zoom-in break-inside-avoid overflow-hidden rounded-sm bg-white/5"
            style={{ aspectRatio: `${shot.w} / ${shot.h}` }}
            aria-label={`Открыть фото: ${shot.alt}`}
          >
            <img
              src={shot.srcSm}
              alt={shot.alt}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-[1200ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.04]"
            />
            <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-[#020202]/80 to-transparent p-4 pt-12 opacity-0 transition-opacity duration-500 group-hover:opacity-100 group-focus-visible:opacity-100">
              <span className="font-serif text-lg italic text-[#E8E6DC]">{shot.series.title}</span>
              <ArrowUpRight className="h-4 w-4 text-[#E8E6DC]" strokeWidth={1.5} />
            </span>
          </button>
        ))}
      </motion.div>
    </section>
  )
}

/* ---------- Просмотр фото поверх страницы ---------- */

function Lightbox({
  shots,
  index,
  onIndex,
  onClose,
}: {
  shots: Shot[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const count = shots.length
  const go = (step: number) => onIndex((index + step + count) % count)
  useModal(true, onClose, closeRef, (e) => {
    if (e.key === 'ArrowRight') go(1)
    if (e.key === 'ArrowLeft') go(-1)
  })
  const shot = shots[index]

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={`${shot.series.title}: ${shot.alt}`}
      className="fixed inset-0 z-[70] flex flex-col bg-[#020202]/95 p-4 backdrop-blur-sm md:p-8"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-4" onClick={(e) => e.stopPropagation()}>
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/50">
          {shot.series.title}
          <span className="ml-3 tabular-nums text-white/30">
            {index + 1} / {count}
          </span>
        </p>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="group flex cursor-pointer items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/60 transition-colors duration-300 hover:text-[#E8E6DC]"
        >
          Закрыть
          <X className="h-4 w-4 transition-transform duration-300 group-hover:rotate-90" strokeWidth={1.6} />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center py-4">
        <AnimatePresence mode="wait" initial={false}>
          <motion.img
            key={shot.id}
            src={shot.src}
            alt={shot.alt}
            className="max-h-full max-w-full object-contain"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
          />
        </AnimatePresence>
      </div>

      {count > 1 && (
        <div className="flex justify-center gap-3" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Предыдущее фото"
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-white/15 text-white/70 transition-colors duration-300 hover:border-[#E8E6DC] hover:text-[#E8E6DC]"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.6} />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Следующее фото"
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-white/15 text-white/70 transition-colors duration-300 hover:border-[#E8E6DC] hover:text-[#E8E6DC]"
          >
            <ArrowRight className="h-4 w-4" strokeWidth={1.6} />
          </button>
        </div>
      )}
    </motion.div>
  )
}

/* ---------- Контакты: отдельный экран после сцены ---------- */

const CONTACTS = [
  { label: 'Telegram', value: '@vaaaaaag', href: TELEGRAM_PERSONAL },
  { label: 'Instagram', value: '@vaag.ph', href: INSTAGRAM },
  { label: 'Канал', value: 't.me/Vaag_ph', href: TELEGRAM_CHANNEL },
  { label: 'Сайт', value: SITE_HOST, href: SITE },
]

const noop = () => {}

/** Какое окно открыто и на каком разделе. */
type DialogState = { section: 'booking' | 'about' | 'contacts'; packageId?: PackageId } | null

const reveal = {
  initial: { opacity: 0, y: 40, filter: 'blur(10px)' },
  whileInView: { opacity: 1, y: 0, filter: 'blur(0px)' },
  viewport: { once: true, amount: 0.3 },
}

/**
 * Контакты. Без `dialog` — отдельный экран в конце страницы.
 * С `dialog` — тот же экран поверх страницы, открывается кнопкой «Записаться» прямо на месте.
 */
function ContactsSection({
  dialog = false,
  onClose,
  section = 'booking',
  packageId,
}: {
  dialog?: boolean
  onClose?: () => void
  section?: 'booking' | 'about' | 'contacts'
  packageId?: PackageId
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = dialog ? 'contacts-dialog-title' : 'contacts-title'

  useModal(dialog, onClose ?? noop, closeRef)

  // Окно открыли кнопкой «Контакты» или «Обо мне» — сразу показываем этот раздел
  useEffect(() => {
    if (dialog && section !== 'booking') document.getElementById(`dlg-${section}`)?.scrollIntoView({ block: 'start' })
  }, [dialog, section])

  const appear = dialog
    ? { initial: { opacity: 0, y: 30 }, animate: { opacity: 1, y: 0 } }
    : reveal

  const body = (
    <>
      <div className="flex items-start justify-between gap-6">
        <img src={asset('logo.svg')} alt="VAAAAAAG" width={48} height={48} className="h-12 w-12" />
        {dialog ? (
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="group flex cursor-pointer items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/60 transition-colors duration-300 hover:text-[#E8E6DC]"
          >
            Закрыть
            <X className="h-4 w-4 transition-transform duration-300 group-hover:rotate-90" strokeWidth={1.6} />
          </button>
        ) : null}
      </div>

      {dialog && (
        <motion.section
          id="dlg-booking"
          className="scroll-mt-6 border-b border-white/10 pb-16"
          aria-labelledby="booking-title"
          {...appear}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
        >
          <BookingFlow initialPackage={packageId} />
        </motion.section>
      )}

      {dialog && (
        <motion.section
          id="dlg-about"
          className="grid scroll-mt-6 grid-cols-1 gap-8 border-b border-white/10 pb-16 lg:grid-cols-12"
          aria-labelledby="about-title"
          {...appear}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="lg:col-span-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/40">Обо мне</p>
            <h2
              id="about-title"
              className="mt-5 font-serif uppercase leading-[0.9] text-[#E8E6DC]"
              style={{ fontSize: 'clamp(2rem, 3.6vw, 4.5rem)' }}
            >
              {ABOUT.title}
              <br />
              <em className="italic">
                {ABOUT.titleAccent.split(' ').map((word, i) => (
                  // «Санкт-Петербурге» не переносим по дефису
                  <span key={i} className="whitespace-nowrap">
                    {i > 0 && ' '}
                    {word}
                  </span>
                ))}
              </em>
            </h2>
          </div>
          <div className="flex max-w-[600px] flex-col gap-5 text-[15px] leading-[1.7] text-white/70 lg:col-span-6 lg:col-start-7 lg:pt-10">
            {ABOUT.paragraphs.map((text) => (
              <p key={text}>{text}</p>
            ))}

            <div className="mt-6">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/40">Биография</h3>
              <ol className="relative mt-5 flex flex-col gap-6 border-l border-white/15 pl-6 text-[14px] leading-relaxed">
                {ABOUT.bio.map((text, i) => (
                  <li key={text} className="relative">
                    <span
                      className={`absolute -left-[28.5px] top-[0.55em] h-2 w-2 rounded-full ${
                        i === 0 ? 'bg-[#E8E6DC]' : 'border border-[#E8E6DC]/60 bg-[#020202]'
                      }`}
                      aria-hidden="true"
                    />
                    {text}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </motion.section>
      )}

      <div id={dialog ? 'dlg-contacts' : undefined} className="grid scroll-mt-6 grid-cols-1 items-end gap-12 lg:grid-cols-12 lg:gap-8">
        <motion.div
          className="lg:col-span-7"
          {...appear}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/40">Контакты</p>
          <h2
            id={titleId}
            className="mt-5 font-serif uppercase leading-[0.88] text-[#E8E6DC]"
            style={{ fontSize: 'clamp(2.5rem, 5.6vw, 7.5rem)' }}
          >
            Напиши мне —
            <br />
            <em className="italic">договоримся</em>
            <br />
            <em className="italic">о тишине</em>
          </h2>
          <p className="mt-8 max-w-[420px] text-[13px] leading-relaxed text-white/55">
            Расскажи идею и удобные даты. Подберу локацию, время и пакет под настроение, которое хочется
            сохранить.
          </p>
          <a
            href={TELEGRAM_PERSONAL}
            target="_blank"
            rel="noreferrer"
            className="group mt-8 inline-flex items-center gap-3 rounded-full border border-white/20 px-6 py-3.5 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-white transition-colors duration-300 hover:border-[#E8E6DC] hover:bg-[#E8E6DC] hover:text-[#121212]"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#E8E6DC] opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#E8E6DC] transition-colors duration-300 group-hover:bg-[#121212]" />
            </span>
            Написать в Telegram
          </a>
        </motion.div>

        <motion.ul
          className="divide-y divide-white/10 border-y border-white/10 text-[15px] lg:col-span-5"
          {...appear}
          transition={{ duration: 1.1, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
        >
          {CONTACTS.map((c) => (
            <ContactRow key={c.label} {...c} />
          ))}
        </motion.ul>
      </div>

      <footer className="flex flex-col gap-2 text-[11px] text-white/35 sm:flex-row sm:items-center sm:justify-between">
        <span>© {new Date().getFullYear()} VAAAAAAG — фоткает</span>
        <a href="#privacy" className="underline-offset-4 hover:text-[#E8E6DC] hover:underline">
          Политика конфиденциальности
        </a>
        <span>Санкт-Петербург и область</span>
        {!dialog && (
          // «Наверх» внизу: правый верхний угол занят закреплённой кнопкой записи
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="group flex cursor-pointer items-center gap-2 self-start text-[10px] font-semibold uppercase tracking-[0.22em] text-white/50 transition-colors duration-300 hover:text-[#E8E6DC] sm:self-auto"
          >
            Наверх
            <ArrowUp className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-y-0.5" strokeWidth={1.6} />
          </button>
        )}
      </footer>
    </>
  )

  const layout = 'flex min-h-[100svh] flex-col justify-between gap-16 bg-[#020202] p-6 md:p-10 lg:p-12'

  if (dialog) {
    return (
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-title"
        className={`fixed inset-0 z-[60] overflow-y-auto ${layout}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        {body}
      </motion.div>
    )
  }

  return (
    <section id="contacts" className={`relative z-40 border-t border-white/10 ${layout}`} aria-labelledby={titleId}>
      {body}
    </section>
  )
}

/* ---------- Запись на съёмку ---------- */

const WEEK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function monthLabel(ym: string) {
  const label = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${ym}-01T00:00:00Z`))
    .replace(/\s*г\.$/, '')
  return label[0].toUpperCase() + label.slice(1)
}

function shiftMonth(ym: string, step: number) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + step, 1))
  return d.toISOString().slice(0, 7)
}

/** Ячейки месяца, неделя с понедельника; null — пустые клетки до первого числа. */
function monthCells(ym: string): (string | null)[] {
  const first = `${ym}-01`
  const lead = (weekday(first) + 6) % 7
  const cells: (string | null)[] = Array(lead).fill(null)
  for (let d = first; d.startsWith(ym); d = addDays(d, 1)) cells.push(d)
  return cells
}

type Slots = Record<string, string[]>
type SlotsData = { first: string; last: string; times: string[]; slots: Slots }
type SlotsState = { status: 'loading' } | ({ status: 'ready' } & SlotsData) | { status: 'error' }
type SendState =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'sent'; request: BookingRequest; token: string }
  | { status: 'manual'; request: BookingRequest }
  | { status: 'error'; message: string }

function BookingFlow({ initialPackage }: { initialPackage?: PackageId }) {
  const { packages, live, telegramBot } = useContent()
  // С сервером — его расписание и проверка; без сервера (превью) — демо-режим
  const online = live && API !== null
  const window_ = bookingWindow()
  const [packageId, setPackageId] = useState<PackageId>(
    initialPackage ?? (packages.find((p) => p.id === 'standard') ?? packages[0]).id,
  )
  const [date, setDate] = useState<string | null>(null)
  const [time, setTime] = useState<string | null>(null)
  const [month, setMonth] = useState(window_.first.slice(0, 7))
  const [form, setForm] = useState({ name: '', contact: '', comment: '', website: '', consent: false })
  const [slots, setSlots] = useState<SlotsState>({ status: 'loading' })
  const [send, setSend] = useState<SendState>({ status: 'idle' })
  const [fieldError, setFieldError] = useState<string | null>(null)

  const loadSlots = useCallback(async () => {
    if (!online) {
      // Демо: сервер не подключён, показываем все окошки по расписанию по умолчанию
      setSlots({ status: 'ready', first: window_.first, last: window_.last, times: SLOT_TIMES, slots: allSlots(window_.first, window_.last) })
      return
    }
    setSlots({ status: 'loading' })
    try {
      const res = await fetch(`${API}/slots`)
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as SlotsData
      setSlots({ status: 'ready', ...data })
      setMonth((m) => (m < data.first.slice(0, 7) ? data.first.slice(0, 7) : m))
    } catch {
      setSlots({ status: 'error' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online])

  useEffect(() => {
    loadSlots()
  }, [loadSlots])

  const free: Slots = slots.status === 'ready' ? slots.slots : {}
  const times = slots.status === 'ready' ? slots.times : SLOT_TIMES
  const selectedPkg = packages.find((p) => p.id === packageId) ?? packages[0]
  const firstMonth = (slots.status === 'ready' ? slots.first : window_.first).slice(0, 7)
  const lastMonth = (slots.status === 'ready' ? slots.last : window_.last).slice(0, 7)

  const request = (): BookingRequest | null =>
    date && time
      ? { packageId: selectedPkg.id, date, time, name: form.name, contact: form.contact, comment: form.comment, website: form.website, consent: form.consent }
      : null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const r = request()
    const problem = !r ? (date ? 'Выберите время.' : 'Выберите дату.') : online ? validateContactFields(r) : validateBooking(r)
    if (problem || !r) {
      setFieldError(problem)
      return
    }
    setFieldError(null)

    if (!online) {
      setSend({ status: 'manual', request: r })
      return
    }

    setSend({ status: 'sending' })
    try {
      const res = await fetch(`${API}/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(r),
      })
      const data = (await res.json().catch(() => ({}))) as { detail?: string; token?: string }
      if (res.ok && data.token) {
        setSend({ status: 'sent', request: r, token: data.token })
        return
      }
      if (res.status === 409) {
        setTime(null)
        loadSlots()
      }
      setSend({ status: 'error', message: data.detail ?? 'Не получилось отправить заявку. Напишите мне в Telegram.' })
    } catch {
      setSend({ status: 'error', message: 'Нет связи с сервером. Проверьте интернет или напишите мне в Telegram.' })
    }
  }

  const eyebrow = 'text-[10px] font-semibold uppercase tracking-[0.25em] text-white/40'
  const input =
    'w-full rounded-sm border border-white/15 bg-white/[0.03] px-4 py-3 text-[14px] text-white placeholder:text-white/30 transition-colors duration-300 focus:border-[#E8E6DC] focus:outline-none'

  if (send.status === 'sent' || send.status === 'manual') {
    const r = send.request
    const text = bookingMessage(r, selectedPkg)
    return (
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-12" aria-live="polite">
        <div className="lg:col-span-6">
          <p className={eyebrow}>Запись на съёмку</p>
          <h2 id="booking-title" className="mt-5 font-serif uppercase leading-[0.9] text-[#E8E6DC]" style={{ fontSize: 'clamp(2.25rem, 4.2vw, 5rem)' }}>
            {send.status === 'sent' ? (
              <>
                Заявка
                <br />
                <em className="italic">отправлена</em>
              </>
            ) : (
              <>
                Осталось
                <br />
                <em className="italic">отправить</em>
              </>
            )}
          </h2>
          <p className="mt-6 max-w-[440px] text-[14px] leading-relaxed text-white/60">
            {send.status === 'sent'
              ? 'Окошко за вами. Я посмотрю заявку и подтвержу съёмку — статус можно проверить по ссылке ниже.'
              : 'Скопируйте текст заявки и отправьте его мне в Telegram — так я увижу её сразу.'}
          </p>
          {send.status === 'sent' && (
            <div className="mt-8 flex flex-wrap gap-3">
              {telegramBot && (
                <a
                  href={`https://t.me/${telegramBot}?start=b_${send.token}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full bg-[#E8E6DC] px-6 py-3 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-[#121212] transition-colors duration-300 hover:bg-white"
                >
                  <Send className="h-3.5 w-3.5" strokeWidth={1.8} />
                  Уведомления в Telegram
                </a>
              )}
              <a
                href={`#booking-${send.token}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-3 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-white transition-colors duration-300 hover:border-[#E8E6DC] hover:text-[#E8E6DC]"
              >
                Статус заявки
                <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.8} />
              </a>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-5 lg:col-span-6">
          <pre className="whitespace-pre-wrap rounded-sm border border-white/10 bg-white/[0.03] p-5 font-sans text-[13px] leading-relaxed text-white/80">
            {text}
          </pre>
          {send.status === 'manual' && (
            <div className="flex flex-wrap gap-3">
              <CopyButton text={text} />
              <a
                href={TELEGRAM_PERSONAL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-[#E8E6DC] px-6 py-3 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-[#121212] transition-colors duration-300 hover:bg-white"
              >
                Открыть Telegram @vaaaaaag
                <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.8} />
              </a>
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              setSend({ status: 'idle' })
              setDate(null)
              setTime(null)
              loadSlots()
            }}
            className="self-start text-[11px] text-white/45 underline underline-offset-4 transition-colors hover:text-[#E8E6DC]"
          >
            Записаться ещё раз
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-12">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className={eyebrow}>Запись на съёмку</p>
          <h2 id="booking-title" className="mt-5 font-serif uppercase leading-[0.9] text-[#E8E6DC]" style={{ fontSize: 'clamp(2.25rem, 4.2vw, 5rem)' }}>
            Выберите
            <br />
            <em className="italic">своё окошко</em>
          </h2>
        </div>
        <p className="max-w-[360px] text-[12.5px] leading-relaxed text-white/45 lg:text-right">
          Время — по Петербургу. Заявка придёт мне в Telegram, после неё я подтвержу съёмку лично.
        </p>
      </div>

      {/* 1. Пакет */}
      <fieldset>
        <legend className={eyebrow}>1 · Пакет</legend>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {packages.map((p: Package) => {
            const active = p.id === packageId
            return (
              <label
                key={p.id}
                className={`flex cursor-pointer flex-col gap-1 rounded-sm border p-4 transition-colors duration-300 has-[:focus-visible]:border-[#E8E6DC] ${
                  active ? 'border-[#E8E6DC] bg-[#E8E6DC]/[0.06]' : 'border-white/10 hover:border-white/30'
                }`}
              >
                <input type="radio" name="package" value={p.id} checked={active} onChange={() => setPackageId(p.id)} className="sr-only" />
                <span className="flex items-center justify-between">
                  <span className="text-[13px] font-medium text-white">{p.name}</span>
                  <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${active ? 'border-[#E8E6DC] bg-[#E8E6DC]' : 'border-white/30'}`}>
                    {active && <Check className="h-3 w-3 text-[#121212]" strokeWidth={3} />}
                  </span>
                </span>
                <span className="text-[11px] uppercase tracking-[0.16em] text-white/45">{packageSummary(p)}</span>
                <span className="mt-2 font-serif text-2xl text-[#E8E6DC]">{formatPrice(p.price)}</span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-10">
        {/* 2. Дата */}
        <fieldset className="lg:col-span-6">
          <legend className={eyebrow}>2 · Дата</legend>
          <div className="mt-4 max-w-[460px] rounded-sm border border-white/10 p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setMonth((m) => shiftMonth(m, -1))}
                disabled={month <= firstMonth}
                aria-label="Предыдущий месяц"
                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-white/60 transition-colors hover:text-[#E8E6DC] disabled:cursor-default disabled:opacity-25"
              >
                <ArrowLeft className="h-4 w-4" strokeWidth={1.6} />
              </button>
              <p className="font-serif text-xl text-white/90" aria-live="polite">{monthLabel(month)}</p>
              <button
                type="button"
                onClick={() => setMonth((m) => shiftMonth(m, 1))}
                disabled={month >= lastMonth}
                aria-label="Следующий месяц"
                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-white/60 transition-colors hover:text-[#E8E6DC] disabled:cursor-default disabled:opacity-25"
              >
                <ArrowRight className="h-4 w-4" strokeWidth={1.6} />
              </button>
            </div>
            <div className="mt-4 grid grid-cols-7 gap-1 text-center">
              {WEEK.map((d) => (
                <span key={d} className="pb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-white/30">
                  {d}
                </span>
              ))}
              {monthCells(month).map((d, i) => {
                if (!d) return <span key={`e${i}`} />
                const open = (free[d]?.length ?? 0) > 0
                const selected = d === date
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={!open}
                    onClick={() => {
                      setDate(d)
                      setTime(null)
                      setFieldError(null)
                    }}
                    aria-pressed={selected}
                    aria-label={`${formatDateRu(d)}${open ? `, свободно окошек: ${free[d].length}` : ', нет свободного времени'}`}
                    className={`relative aspect-square rounded-full text-[13px] tabular-nums transition-colors duration-200 ${
                      selected
                        ? 'cursor-pointer bg-[#E8E6DC] font-semibold text-[#121212]'
                        : open
                          ? 'cursor-pointer text-white/85 hover:bg-white/10'
                          : 'cursor-default text-white/20'
                    }`}
                  >
                    {Number(d.slice(8))}
                    {open && !selected && <span className="absolute bottom-1.5 left-1/2 h-[3px] w-[3px] -translate-x-1/2 rounded-full bg-[#E8E6DC]/60" aria-hidden="true" />}
                  </button>
                )
              })}
            </div>
            {slots.status === 'loading' && <p className="mt-3 text-[12px] text-white/40">Загружаю свободное время…</p>}
            {slots.status === 'error' && (
              <p className="mt-3 text-[12px] text-white/60">
                Не удалось загрузить расписание.{' '}
                <button type="button" onClick={loadSlots} className="underline underline-offset-4 hover:text-[#E8E6DC]">
                  Попробовать ещё раз
                </button>
              </p>
            )}
          </div>
        </fieldset>

        {/* 3. Время и 4. Контакты */}
        <div className="flex flex-col gap-10 lg:col-span-6">
          <fieldset>
            <legend className={eyebrow}>3 · Время</legend>
            {date ? (
              <>
                <p className="mt-4 text-[13px] text-white/60">{formatDateRu(date)}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {times.map((t) => {
                    const open = free[date]?.includes(t)
                    const selected = t === time
                    return (
                      <button
                        key={t}
                        type="button"
                        disabled={!open}
                        onClick={() => {
                          setTime(t)
                          setFieldError(null)
                        }}
                        aria-pressed={selected}
                        className={`rounded-full border px-3 py-2.5 text-[13px] tabular-nums transition-colors duration-200 ${
                          selected
                            ? 'cursor-pointer border-[#E8E6DC] bg-[#E8E6DC] font-semibold text-[#121212]'
                            : open
                              ? 'cursor-pointer border-white/15 text-white/85 hover:border-[#E8E6DC]'
                              : 'cursor-default border-white/5 text-white/25 line-through'
                        }`}
                      >
                        {t}
                        {!open && <span className="sr-only"> — занято</span>}
                      </button>
                    )
                  })}
                </div>
              </>
            ) : (
              <p className="mt-4 text-[13px] text-white/40">Сначала выберите дату в календаре.</p>
            )}
          </fieldset>

          <fieldset className="flex flex-col gap-3">
            <legend className={eyebrow}>4 · Как с вами связаться</legend>
            <label className="mt-4 flex flex-col gap-1.5">
              <span className="text-[12px] text-white/55">Имя</span>
              <input
                id="booking-name"
                className={input}
                value={form.name}
                maxLength={LIMITS.name}
                autoComplete="name"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] text-white/55">Telegram или телефон</span>
              <input
                id="booking-contact"
                className={input}
                value={form.contact}
                maxLength={LIMITS.contact}
                placeholder="@username или +7 …"
                autoComplete="tel"
                onChange={(e) => setForm({ ...form, contact: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] text-white/55">Идея съёмки, образ, локация — по желанию</span>
              <textarea
                id="booking-comment"
                className={`${input} min-h-[96px] resize-y`}
                value={form.comment}
                maxLength={LIMITS.comment}
                onChange={(e) => setForm({ ...form, comment: e.target.value })}
              />
            </label>
            {/* Ловушка для ботов: скрыта от людей */}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={form.website}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
              className="absolute -left-[9999px] h-px w-px opacity-0"
              aria-hidden="true"
            />
          </fieldset>
        </div>
      </div>

      {/* Согласие на обработку персональных данных (152-ФЗ) */}
      <label className="-mb-6 flex cursor-pointer items-start gap-3 text-[12.5px] leading-relaxed text-white/60">
        <input
          id="booking-consent"
          type="checkbox"
          checked={form.consent}
          onChange={(e) => {
            setForm({ ...form, consent: e.target.checked })
            setFieldError(null)
          }}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[#E8E6DC]"
        />
        <span>
          Соглашаюсь на обработку персональных данных и принимаю{' '}
          <a href="#privacy" target="_blank" rel="noreferrer" className="text-white/85 underline underline-offset-4 hover:text-[#E8E6DC]">
            политику конфиденциальности
          </a>
        </span>
      </label>

      {/* Итог и отправка */}
      <div className="flex flex-col gap-4 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-[13px] text-white/60" aria-live="polite">
          <span className="text-white">{selectedPkg.name}</span> · {packageSummary(selectedPkg)} · <span className="font-serif text-lg text-[#E8E6DC]">{formatPrice(selectedPkg.price)}</span>
          <br />
          {date ? formatDateRu(date) : 'дата не выбрана'}
          {time ? `, ${time}` : date ? ', время не выбрано' : ''}
        </div>
        <button
          type="submit"
          disabled={send.status === 'sending'}
          className="group inline-flex cursor-pointer items-center justify-center gap-3 rounded-full bg-[#E8E6DC] px-7 py-4 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-[#121212] transition-colors duration-300 hover:bg-white disabled:cursor-wait disabled:opacity-60"
        >
          {send.status === 'sending' ? 'Отправляю…' : 'Отправить заявку'}
          <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" strokeWidth={1.8} />
        </button>
      </div>
      {(fieldError || send.status === 'error') && (
        <p role="alert" className="-mt-8 text-[13px] text-[#E8E6DC]">
          {fieldError ?? (send.status === 'error' ? send.message : '')}{' '}
          {send.status === 'error' && (
            <a href={TELEGRAM_PERSONAL} target="_blank" rel="noreferrer" className="underline underline-offset-4">
              Telegram @vaaaaaag
            </a>
          )}
        </p>
      )}
      {!online && (
        <p className="-mt-8 text-[11.5px] text-white/35">
          Онлайн-запись пока в тестовом режиме: после нажатия вы получите готовый текст заявки для Telegram.
        </p>
      )}
    </form>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 2000)
          })
          .catch(() => {
            // Буфер обмена недоступен — выделяем текст, чтобы скопировать вручную
            const pre = document.querySelector('pre')
            if (pre) window.getSelection()?.selectAllChildren(pre)
          })
      }}
      className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/20 px-6 py-3 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-white transition-colors duration-300 hover:border-[#E8E6DC] hover:text-[#E8E6DC]"
    >
      {copied ? <Check className="h-3.5 w-3.5" strokeWidth={2} /> : <Copy className="h-3.5 w-3.5" strokeWidth={1.8} />}
      {copied ? 'Скопировано' : 'Скопировать текст'}
    </button>
  )
}

/** Кнопка «Записаться». `placeholder` — невидимая копия, держит для неё место в меню. */
function BookButton({ onClick, placeholder = false }: { onClick?: () => void; placeholder?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      {...(placeholder ? { 'aria-hidden': true, tabIndex: -1, disabled: true } : {})}
      className={`group flex cursor-pointer items-center gap-2.5 rounded-full border border-white/25 bg-[#020202]/70 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-white shadow-[0_8px_30px_rgba(0,0,0,0.35)] backdrop-blur-md transition-colors duration-300 hover:border-[#E8E6DC] hover:bg-[#E8E6DC] hover:text-[#121212] ${
        placeholder ? 'invisible' : ''
      }`}
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#E8E6DC] opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#E8E6DC] transition-colors duration-300 group-hover:bg-[#121212]" />
      </span>
      <span className="hidden sm:inline">Записаться</span>
      <span className="sm:hidden">Запись</span>
    </button>
  )
}

function ContactRow({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="group flex items-center justify-between py-5 text-white/80 transition-colors duration-300 hover:text-[#E8E6DC]"
      >
        <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/40">{label}</span>
        <span className="flex items-center gap-2">
          {value}
          <ArrowUpRight
            className="h-3.5 w-3.5 opacity-40 transition-all duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100"
            strokeWidth={1.6}
          />
        </span>
      </a>
    </li>
  )
}
