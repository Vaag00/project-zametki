import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, Send, X } from 'lucide-react'

/* ---------- Константы ---------- */

const ACCENT = '#E8E6DC'
const TELEGRAM_CHANNEL = 'https://t.me/Vaag_ph'
const TELEGRAM_PERSONAL = 'https://t.me/vaaaaaag'
const INSTAGRAM = 'https://instagram.com/vaag.ph'
const SITE = 'https://vaag-ph.ru'

/** Путь к файлу из /public с учётом base, чтобы сборка работала не только из корня сайта. */
const asset = (file: string) => `${import.meta.env.BASE_URL}${file}`

const LERP_SCROLL = 0.05
const LERP_VIDEO = 0.08

type Package = { name: string; photos: string; price: number }
type Panel = {
  id: 1 | 2
  category: string
  title: string
  description: string
  image: string
  packages: Package[]
}

const FEATURES = [
  'Консультация по подготовке',
  'Подбор локаций и маршрута',
  'Авторская обработка с художественной ретушью',
  'Закрытый доступ к фото на облачном диске',
]

const PANELS: Record<1 | 2, Panel> = {
  1: {
    id: 1,
    category: 'Серия · Лес и туман',
    title: 'Минимальный и Стандартный пакет',
    description:
      'Неспешная прогулка по лесу или берегу залива на рассвете. Туман, влажный воздух, мягкий свет — и ты в нём.',
    image: asset('series1.jpg'),
    packages: [
      { name: 'Минимальный', photos: '50 фото', price: 6500 },
      { name: 'Стандартный', photos: '100 фото', price: 9000 },
    ],
  },
  2: {
    id: 2,
    category: 'Серия · Тёмные образы',
    title: 'Максимальный пакет',
    description:
      'Длинная съёмка с несколькими образами и локациями. Глубокие тени, вода, драматичный свет — история целиком.',
    image: asset('series2.jpg'),
    packages: [{ name: 'Максимальный', photos: '200 фото + флешка', price: 15000 }],
  },
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
 * Новое фото: положить public/portfolio/<id>.jpg (до 1800 px) и <id>-sm.jpg (до 900 px)
 * и добавить строку в нужную серию. Новая серия — новый объект в SERIES.
 * Первое фото серии — её обложка на первом экране, поэтому лучше вертикальное. */
type Photo = { id: string; w: number; h: number; alt: string }
type Series = { id: string; title: string; description: string; photos: Photo[] }

const SERIES: Series[] = [
  {
    id: 'forest',
    title: 'Лес и туман',
    description: 'Лесные тропы, старые ели и рассеянный свет сквозь хвою.',
    photos: [
      { id: 'forest-road', w: 2, h: 3, alt: 'Девушка на лесной дороге запрокинула голову к свету' },
      { id: 'forest-tree', w: 2, h: 3, alt: 'Портрет у ствола старой ели' },
    ],
  },
  {
    id: 'dark',
    title: 'Тёмные образы',
    description: 'Готические арки, камень и тень. Драматичный свет и образы на грани сказки.',
    photos: [
      { id: 'dark-arch', w: 2, h: 3, alt: 'Кружение в белой юбке под каменной аркой' },
      { id: 'dark-door', w: 3, h: 2, alt: 'Портрет у готической двери склепа' },
    ],
  },
]

const photoSrc = (id: string, small = false) => asset(`portfolio/${id}${small ? '-sm' : ''}.jpg`)

type Shot = Photo & { series: Series }
const shotsOf = (filter: string): Shot[] =>
  SERIES.filter((x) => filter === 'all' || x.id === filter).flatMap((x) =>
    x.photos.map((photo) => ({ ...photo, series: x })),
  )

const NAV = [
  { label: 'Портфолио', target: 'portfolio' as const },
  { label: 'Услуги', target: 0.45 },
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

const formatPrice = (n: number) => `${n.toLocaleString('ru-RU')} ₽`

/** Мгновенный переход к разделу после сцены: плавная прокрутка проматывала бы все панели. */
function jumpTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'instant', block: 'start' })
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
  const [progress, setProgress] = useState(0)
  const [contactsOpen, setContactsOpen] = useState(false)
  const closeContacts = useCallback(() => setContactsOpen(false), [])

  const [portfolioFilter, setPortfolioFilter] = useState('all')
  const [lightbox, setLightbox] = useState<{ shots: Shot[]; index: number } | null>(null)
  const closeLightbox = useCallback(() => setLightbox(null), [])
  const openSeries = (id: string) => {
    setPortfolioFilter(id)
    jumpTo('portfolio')
  }

  // Карточка на первом экране листает серии; на наведении — пауза
  const [heroSeries, setHeroSeries] = useState(0)
  const heroPausedRef = useRef(false)
  useEffect(() => {
    if (SERIES.length < 2) return
    const timer = window.setInterval(() => {
      if (!heroPausedRef.current) setHeroSeries((i) => (i + 1) % SERIES.length)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [])
  const hero = SERIES[heroSeries]

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
                        ? setContactsOpen(true)
                        : item.target === 'portfolio'
                          ? jumpTo('portfolio')
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

            <button
              type="button"
              onClick={() => setContactsOpen(true)}
              aria-haspopup="dialog"
              className="group flex cursor-pointer items-center gap-2.5 rounded-full border border-white/20 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-white transition-colors duration-300 hover:border-[#E8E6DC] hover:bg-[#E8E6DC] hover:text-[#121212]"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#E8E6DC] opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#E8E6DC] transition-colors duration-300 group-hover:bg-[#121212]" />
              </span>
              <span className="hidden sm:inline">Записаться</span>
              <span className="sm:hidden">Запись</span>
            </button>
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
                  {SERIES.length > 1 && (
                    <div className="flex gap-1.5">
                      {SERIES.map((x, i) => (
                        <button
                          key={x.id}
                          type="button"
                          onClick={() => setHeroSeries(i)}
                          aria-label={`Показать серию «${x.title}»`}
                          aria-current={i === heroSeries}
                          className="group/dot flex h-4 cursor-pointer items-center"
                        >
                          <span
                            className={`block h-px transition-all duration-500 ${
                              i === heroSeries ? 'w-6 bg-[#E8E6DC]' : 'w-3 bg-white/25 group-hover/dot:bg-white/60'
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
                  onClick={() => openSeries(hero.id)}
                  className="hero-card relative block aspect-[4/5] w-full cursor-pointer overflow-hidden rounded-sm border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.01] p-3 transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-[1.04]"
                  aria-label={`Открыть серию «${hero.title}» в портфолио`}
                >
                  <span className="relative block h-full w-full overflow-hidden">
                    <AnimatePresence initial={false}>
                      <motion.img
                        key={hero.id}
                        src={photoSrc(hero.photos[0].id, true)}
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
                от 6 500 ₽
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
                {FEATURES.map((f) => (
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
                          {selectedPackage.photos}
                        </span>
                      </motion.span>
                    </AnimatePresence>
                  </div>
                </div>

                <a
                  href={TELEGRAM_CHANNEL}
                  target="_blank"
                  rel="noreferrer"
                  className="group inline-flex items-center justify-center gap-2 rounded-full bg-[#121212] px-6 py-3.5 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-[#FAF9F5] transition-colors duration-300 hover:bg-[#2a2a28]"
                >
                  Забронировать съёмку
                  <ArrowUpRight
                    className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                    strokeWidth={1.8}
                  />
                </a>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </aside>

      {/* Длина сцены: прокрутка по ней управляет видео и панелями */}
      <div id="stage" className="h-[650vh]" aria-hidden="true" />

      <PortfolioSection
        filter={portfolioFilter}
        onFilter={setPortfolioFilter}
        onOpen={(shots, index) => setLightbox({ shots, index })}
      />

      <ContactsSection />

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
        {contactsOpen && <ContactsSection dialog onClose={closeContacts} />}
      </AnimatePresence>
    </div>
  )
}

/* ---------- Портфолио: раздел после сцены ---------- */

function PortfolioSection({
  filter,
  onFilter,
  onOpen,
}: {
  filter: string
  onFilter: (id: string) => void
  onOpen: (shots: Shot[], index: number) => void
}) {
  const shots = shotsOf(filter)
  const current = SERIES.find((x) => x.id === filter)
  const tabs = [{ id: 'all', title: 'Все' }, ...SERIES]

  return (
    <section
      id="portfolio"
      className="relative z-40 min-h-[100svh] border-t border-white/10 bg-[#020202] p-6 md:p-10 lg:p-12"
      aria-labelledby="portfolio-title"
    >
      <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/40">Серии</p>
          <h2
            id="portfolio-title"
            className="mt-5 font-serif uppercase leading-[0.9] text-[#E8E6DC]"
            style={{ fontSize: 'clamp(2.5rem, 5.6vw, 7.5rem)' }}
          >
            Портфолио
          </h2>
        </div>

        <div className="flex flex-col gap-4 lg:items-end">
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
          <p className="min-h-[1.5em] max-w-[420px] text-[12.5px] leading-relaxed text-white/45 lg:text-right">
            {current ? current.description : `${plural(SERIES.length, 'серия', 'серии', 'серий')} · ${shotsOf('all').length} фото`}
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
              src={photoSrc(shot.id, true)}
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
            src={photoSrc(shot.id)}
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
  { label: 'Сайт', value: 'vaag-ph.ru', href: SITE },
]

const noop = () => {}

const reveal = {
  initial: { opacity: 0, y: 40, filter: 'blur(10px)' },
  whileInView: { opacity: 1, y: 0, filter: 'blur(0px)' },
  viewport: { once: true, amount: 0.3 },
}

/**
 * Контакты. Без `dialog` — отдельный экран в конце страницы.
 * С `dialog` — тот же экран поверх страницы, открывается кнопкой «Записаться» прямо на месте.
 */
function ContactsSection({ dialog = false, onClose }: { dialog?: boolean; onClose?: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = dialog ? 'contacts-dialog-title' : 'contacts-title'

  useModal(dialog, onClose ?? noop, closeRef)

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
        ) : (
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="group flex cursor-pointer items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/50 transition-colors duration-300 hover:text-[#E8E6DC]"
          >
            Наверх
            <ArrowUp className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-y-0.5" strokeWidth={1.6} />
          </button>
        )}
      </div>

      {dialog && (
        <motion.section
          className="grid grid-cols-1 gap-8 border-b border-white/10 pb-16 lg:grid-cols-12"
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

      <div className="grid grid-cols-1 items-end gap-12 lg:grid-cols-12 lg:gap-8">
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

      <footer className="flex flex-col gap-2 text-[11px] text-white/35 sm:flex-row sm:justify-between">
        <span>© {new Date().getFullYear()} VAAAAAAG — фоткает</span>
        <span>Санкт-Петербург и область</span>
      </footer>
    </>
  )

  const layout = 'flex min-h-[100svh] flex-col justify-between gap-16 bg-[#020202] p-6 md:p-10 lg:p-12'

  if (dialog) {
    return (
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
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
