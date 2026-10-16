# Сервер записи на съёмку

Маленький сервер на Cloudflare Workers (бесплатный тариф). Он:

- отдаёт сайту свободные окошки (`GET /slots`);
- принимает заявку (`POST /bookings`), сохраняет её в базу и присылает вам сообщение в Telegram;
- не даёт двум людям занять одно окошко, отсекает спам (не больше 3 заявок в час с одного адреса и скрытое поле-ловушка);
- если сообщение в Telegram не ушло, освобождает окошко и просит клиента написать вам напрямую — заявка не потеряется молча.

Расписание, пакеты и цены — в `../shared/booking.ts` (общий файл для сайта и сервера).

## Запуск: один раз, ~15 минут

Нужен компьютер с Node.js 18+.

### 1. Бот в Telegram

1. Откройте [@BotFather](https://t.me/BotFather) → `/newbot` → придумайте имя, например «VAAAAAAG Запись».
2. BotFather пришлёт **токен** вида `123456789:AA...`. Это пароль бота — никому его не показывайте.
3. Найдите своего бота в Telegram и нажмите **Start** (иначе он не сможет вам писать).
4. Откройте в браузере `https://api.telegram.org/bot<ТОКЕН>/getUpdates` (вместо `<ТОКЕН>` — ваш токен).
   Найдите `"chat":{"id":123456789` — это ваш **chat id**.

### 2. Cloudflare

1. Зарегистрируйтесь на [dash.cloudflare.com](https://dash.cloudflare.com) (бесплатно).
2. В терминале:

```bash
cd landing/booking-worker
npm install
npx wrangler login                 # откроется браузер — подтвердите вход
npx wrangler d1 create vaag-booking
```

3. Последняя команда выведет `database_id = "…"`. Вставьте это значение в `wrangler.toml` вместо нулей.
4. Создайте таблицу и задайте секреты (вставите токен и chat id из шага 1):

```bash
npm run db:init
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
```

5. Если сайт будет не на `vaag-ph.ru`, впишите его адрес в `ALLOWED_ORIGINS` в `wrangler.toml`.
6. Выложите сервер:

```bash
npm run deploy
```

Wrangler покажет адрес вида `https://vaag-booking.<ваше-имя>.workers.dev`.

### 3. Подключить сайт

В папке `landing` создайте файл `.env.production`:

```
VITE_BOOKING_API=https://vaag-booking.<ваше-имя>.workers.dev
```

Соберите сайт (`npm run build`) и выложите папку `dist`. Готово: оформите тестовую заявку — она придёт вам в Telegram.

Пока адрес не задан, запись на сайте работает в тестовом режиме: клиент получает готовый текст заявки и сам отправляет его вам в Telegram.

## Повседневное

Посмотреть заявки:

```bash
npx wrangler d1 execute vaag-booking --remote --command "SELECT id, date, time, package_id, name, contact FROM bookings ORDER BY date, time"
```

Освободить окошко (клиент отменил — номер заявки есть в сообщении, `#6`):

```bash
npx wrangler d1 execute vaag-booking --remote --command "DELETE FROM bookings WHERE id = 6"
```

Изменить время съёмок, рабочие дни, цены — `landing/shared/booking.ts`, затем `npm run deploy` здесь и пересобрать сайт.

## Проверка у себя на компьютере

```bash
printf 'TELEGRAM_BOT_TOKEN=<токен>\nTELEGRAM_CHAT_ID=<chat id>\n' > .dev.vars
npm run db:init:local
npm run dev                                   # сервер на http://localhost:8787
# в другом окне, в папке landing:
VITE_BOOKING_API=http://localhost:8787 npm run dev
```
