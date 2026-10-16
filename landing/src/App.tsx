import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ArrowUpRight, Send } from 'lucide-react'

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

const NAV = [
  { label: 'Серии', target: 0.45 },
  { label: 'Услуги', target: 1 },
  { label: 'Обо мне', target: 0.7 },
  { label: 'Контакты', target: 1 },
]

/* ---------- Хелперы ---------- */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

const formatPrice = (n: number) => `${n.toLocaleString('ru-RU')} ₽`

function scrollToFraction(fraction: number) {
  const el = document.documentElement
  window.scrollTo({ top: fraction * (el.scrollHeight - el.clientHeight), behavior: 'smooth' })
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

  const targetScrollFractionRef = useRef(0)
  const currentScrollFractionRef = useRef(0)
  const video1Ref = useRef<HTMLVideoElement>(null)
  const video2Ref = useRef<HTMLVideoElement>(null)
  const rafRef = useRef(0)

  // Скролл → целевая доля
  useEffect(() => {
    const onScroll = () => {
      const el = document.documentElement
      const max = el.scrollHeight - el.clientHeight
      targetScrollFractionRef.current = max > 0 ? clamp01(el.scrollTop / max) : 0
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
    <div className="relative h-[650vh] bg-[#020202] font-sans text-white selection:bg-[#E8E6DC] selection:text-[#121212]">
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
            <ul className="hidden items-center gap-6 md:flex lg:gap-8">
              {NAV.map((item) => (
                <li key={item.label}>
                  <button
                    type="button"
                    onClick={() => scrollToFraction(item.target)}
                    className="group relative cursor-pointer py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-white/70 transition-colors duration-300 hover:text-[#E8E6DC]"
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
              onClick={() => scrollToFraction(1)}
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
            <div className="group w-full max-w-[240px]">
              <div style={s(0.14, 0.25)}>
                <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/40">
                  Серия
                </p>
                <p className="mt-1 font-serif text-2xl italic text-white/90">Туман и вода</p>
                <p className="mt-2 text-[11.5px] leading-relaxed text-white/45">
                  Портреты у воды на рассвете, когда туман ещё не успел подняться.
                </p>
              </div>

              <div className="mt-5" style={s(0.18, 0.29)}>
                <button
                  type="button"
                  onClick={() => scrollToFraction(0.45)}
                  className="hero-card relative block aspect-[4/5] w-full cursor-pointer overflow-hidden rounded-sm border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.01] p-3 transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-[1.04]"
                  aria-label="Открыть серию «Туман и вода»"
                >
                  <img
                    src={asset('hero.png')}
                    alt="Портрет из серии «Туман и вода»"
                    className="h-full w-full object-contain object-bottom"
                  />
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
        <div className="max-w-[420px] text-right" style={getRevealStyle(progress, 0.55, 0.65, 0.78, 0.88)}>
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/40">Обо мне</p>
          <p className="mt-3 font-serif text-3xl leading-[1.05] text-[#E8E6DC] md:text-4xl">
            Я ищу не красивый кадр,
            <br />
            <em className="italic">а честное состояние</em>
          </p>
          <p className="mt-4 text-[12.5px] leading-relaxed text-white/55">
            Снимаю тех, кому близки серое небо, мокрая трава и долгие паузы.
            Помогаю расслабиться в кадре, подсказываю с образом и сам нахожу места, где тишина
            звучит громче всего.
          </p>
        </div>
      </section>

      {/* ---------- Контакты (финал, справа от шторки) ---------- */}
      <section
        className="fixed inset-y-0 right-0 z-20 hidden items-end p-12 lg:flex"
        style={{
          left: 648,
          opacity: progress >= 0.9 ? 1 : 0,
          visibility: progress >= 0.9 ? 'visible' : 'hidden',
          transition: 'opacity 0.9s cubic-bezier(0.16,1,0.3,1), visibility 0.9s',
        }}
        aria-label="Контакты"
      >
        <div className="ml-auto w-full max-w-[360px]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/40">Контакты</p>
          <p className="mt-3 font-serif text-4xl leading-none text-[#E8E6DC]">
            Напиши мне —<br />
            <em className="italic">договоримся о тишине</em>
          </p>
          <ul className="mt-8 divide-y divide-white/10 border-y border-white/10 text-[13px]">
            <ContactRow label="Telegram" value="@vaaaaaag" href={TELEGRAM_PERSONAL} />
            <ContactRow label="Instagram" value="@vaag.ph" href={INSTAGRAM} />
            <ContactRow label="Канал" value="t.me/Vaag_ph" href={TELEGRAM_CHANNEL} />
            <ContactRow label="Сайт" value="vaag-ph.ru" href={SITE} />
          </ul>
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
                  className="absolute inset-0 h-full w-full object-cover"
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

              {/* Контакты в шторке — для экранов, где правый блок не помещается */}
              <p className="mt-5 text-center text-[10.5px] tracking-wide text-[#8E8B84] lg:hidden">
                <a href={TELEGRAM_PERSONAL} target="_blank" rel="noreferrer" className="hover:text-[#121212]">
                  @vaaaaaag
                </a>
                {' · '}
                <a href={INSTAGRAM} target="_blank" rel="noreferrer" className="hover:text-[#121212]">
                  ig @vaag.ph
                </a>
                {' · '}
                <a href={TELEGRAM_CHANNEL} target="_blank" rel="noreferrer" className="hover:text-[#121212]">
                  t.me/Vaag_ph
                </a>
                {' · '}
                <a href={SITE} target="_blank" rel="noreferrer" className="hover:text-[#121212]">
                  vaag-ph.ru
                </a>
              </p>
            </motion.div>
          </AnimatePresence>
        </div>
      </aside>
    </div>
  )
}

function ContactRow({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="group flex items-center justify-between py-3.5 text-white/80 transition-colors duration-300 hover:text-[#E8E6DC]"
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
