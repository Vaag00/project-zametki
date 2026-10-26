# VAAAAAAG — фоткает

Сайт фотографа с онлайн-записью, админкой и ботом Telegram.

**Как запустить на своём сервере — [DEPLOY.md](DEPLOY.md).**

## Что внутри

| Часть | Где | Что делает |
|-------|-----|-----------|
| Сайт | `src/`, `public/` | React 19 + TypeScript + Vite, Tailwind CSS v4, motion. Главная со скролл-анимацией, страницы «Портфолио» (`#portfolio`), «Прайс» (`#price`), политика (`#privacy`), статус заявки (`#booking-<код>`) |
| Админка | `src/Admin.tsx` → `#admin` | Заявки, расписание и выходные, прайс, портфолио с загрузкой фото |
| Сервер | `server/` | Python, FastAPI, SQLite. API, база, обработка фото, бот Telegram, резервные копии. Тесты — `server/tests` |
| Общее | `shared/booking.ts` | Даты, проверка заявки, пакеты и расписание по умолчанию |
| Запуск | `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `.env.example` | Один образ (сайт + сервер), Caddy с автоматическим HTTPS |

Пакеты, цены, расписание и портфолио хранятся в базе и меняются в админке.
Первичное наполнение — `server/app/seed.json` и фото из `public/portfolio`.
Без сервера (например, в превью, сборка с `VITE_DEMO=1`) сайт работает на данных по умолчанию,
а запись — в тестовом режиме: клиент получает готовый текст заявки и сам отправляет его в Telegram.

## Разработка

```bash
# сервер
cd landing/server
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
ADMIN_PASSWORD=dev TELEGRAM_POLLING=0 .venv/bin/uvicorn app.main:app --reload
.venv/bin/python -m pytest

# сайт (в другом окне)
cd landing
npm install
npm run dev      # http://localhost:5173, /api проксируется на сервер
```

## Свои материалы

| Файл | Что это |
|------|---------|
| `public/video1.mp4`, `public/video2.mp4` | фоновые видео (сейчас — собраны из фотографий) |
| `public/video1.webm`, `public/video2.webm` | те же видео в WebM — необязательно; если заменили только `.mp4`, удалите `.webm`, иначе браузер покажет старое видео |
| `public/series1.jpg`, `public/series2.jpg` | фото для панелей на главной |
| `public/og.jpg` | превью ссылки в Telegram/ВК (1200×630) |
| `public/logo.svg` | монограмма «V» |

Фото портфолио загружаются через админку.
Тексты, которых нет в админке: свадьбы и события, скидки, частые вопросы — константы `EVENTS`, `DISCOUNTS`, `FAQ` в `src/App.tsx`;
рассказ о себе — `ABOUT`; данные для политики конфиденциальности — `PRIVACY_OPERATOR`.

Для плавной перемотки видео кодируйте его с частыми ключевыми кадрами:

```bash
ffmpeg -i in.mp4 -an -c:v libx264 -crf 28 -g 10 -movflags +faststart video1.mp4
```
