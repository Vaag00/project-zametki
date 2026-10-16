-- Заявки на съёмку. Одно окошко (дата + время) — одна заявка.
CREATE TABLE IF NOT EXISTS bookings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT NOT NULL,           -- YYYY-MM-DD, по Петербургу
  time        TEXT NOT NULL,           -- HH:MM
  package_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  contact     TEXT NOT NULL,
  comment     TEXT NOT NULL DEFAULT '',
  ip_hash     TEXT NOT NULL,           -- для ограничения частоты, сам IP не храним
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (date, time)
);

CREATE INDEX IF NOT EXISTS bookings_ip_created ON bookings (ip_hash, created_at);
