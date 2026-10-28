-- База бота (Cloudflare D1). Применяется при каждом развёртывании, повторно — без вреда.
CREATE TABLE IF NOT EXISTS bookings (
  token TEXT PRIMARY KEY,
  created INTEGER NOT NULL,
  package_id TEXT NOT NULL,
  package_name TEXT NOT NULL,
  package_price INTEGER NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  name TEXT NOT NULL,
  contact TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  client_chat INTEGER,
  owner_msg INTEGER,
  ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS bookings_date ON bookings (date);

-- Занятые окошки. Второй INSERT того же окошка не пройдёт — так одно время не займут дважды.
CREATE TABLE IF NOT EXISTS slots (
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  token TEXT NOT NULL,
  PRIMARY KEY (date, time)
);

-- Мелочи: chat id фотографа, закрытые дни, шаги диалога в боте, счётчики заявок.
CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
