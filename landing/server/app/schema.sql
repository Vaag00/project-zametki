-- Настройки сайта: расписание записи и т. п. Значение — JSON.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Пакеты съёмки (прайс). Редактируются в админке.
CREATE TABLE IF NOT EXISTS packages (
  id        TEXT PRIMARY KEY,                 -- латиницей, например standard
  position  INTEGER NOT NULL DEFAULT 0,
  name      TEXT NOT NULL,
  duration  TEXT NOT NULL DEFAULT '',
  photos    TEXT NOT NULL DEFAULT '',
  price     INTEGER NOT NULL,
  tagline   TEXT NOT NULL DEFAULT '',
  features  TEXT NOT NULL DEFAULT '[]',       -- JSON-массив строк
  note      TEXT NOT NULL DEFAULT '',
  active    INTEGER NOT NULL DEFAULT 1        -- 0 — скрыт с сайта и из записи
);

-- Серии портфолио и их фото.
CREATE TABLE IF NOT EXISTS series (
  id          TEXT PRIMARY KEY,
  position    INTEGER NOT NULL DEFAULT 0,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS photos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id  TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,
  file       TEXT NOT NULL,                   -- имя без расширения: <file>.jpg и <file>-sm.jpg в media/
  w          INTEGER NOT NULL,
  h          INTEGER NOT NULL,
  alt        TEXT NOT NULL DEFAULT ''
);

-- Заявки на съёмку.
CREATE TABLE IF NOT EXISTS bookings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  token             TEXT NOT NULL UNIQUE,     -- для страницы статуса у клиента
  package_id        TEXT NOT NULL,
  package_name      TEXT NOT NULL,            -- снимок на момент заявки: цены могут поменяться
  package_price     INTEGER NOT NULL,
  date              TEXT NOT NULL,            -- YYYY-MM-DD, по Петербургу
  time              TEXT NOT NULL,            -- HH:MM
  name              TEXT NOT NULL,
  contact           TEXT NOT NULL,
  comment           TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'confirmed', 'cancelled')),
  client_chat_id    INTEGER,                  -- клиент подписался на бота
  owner_message_id  INTEGER,                  -- сообщение фотографу (null — ещё не доставлено)
  ip_hash           TEXT NOT NULL,
  consent_at        TEXT NOT NULL,            -- когда дано согласие на обработку ПДн
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Одно окошко — одна действующая заявка; отменённая окошко освобождает.
CREATE UNIQUE INDEX IF NOT EXISTS bookings_active_slot ON bookings (date, time) WHERE status != 'cancelled';
CREATE INDEX IF NOT EXISTS bookings_ip_created ON bookings (ip_hash, created_at);

-- Закрытые даты (отпуск) или отдельные окошки. time = '' — весь день.
CREATE TABLE IF NOT EXISTS blocked (
  date  TEXT NOT NULL,
  time  TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (date, time)
);

-- Сессии админки (храним только хеш токена).
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  expires_at  TEXT NOT NULL
);
