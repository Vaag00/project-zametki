-- Схема базы данных приложения «Заметки» (SQLite).
-- Применяется автоматически при старте сервера (backend/db.py).

-- Пользователи
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL,                 -- логин, как ввёл пользователь
    username_key  TEXT    NOT NULL UNIQUE,          -- логин в нижнем регистре: «Папа» и «папа» — один логин
    password_hash TEXT    NOT NULL,                 -- scrypt$<соль>$<хеш>
    created_at    TEXT    NOT NULL                  -- ISO 8601, UTC
);

-- Сессии входа (один пользователь — много сессий, например с разных устройств)
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT    PRIMARY KEY,                 -- SHA-256 от токена из cookie
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Заметки (один пользователь — много заметок)
CREATE TABLE IF NOT EXISTS notes (
    id         TEXT    PRIMARY KEY,                 -- UUID
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT    NOT NULL DEFAULT '',
    body       TEXT    NOT NULL DEFAULT '',
    tags       TEXT    NOT NULL DEFAULT '[]',       -- JSON-массив строк
    color      TEXT    NOT NULL DEFAULT 'default'
               CHECK (color IN ('default', 'yellow', 'green', 'blue', 'pink', 'purple')),
    pinned     INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
    archived   INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    created_at TEXT    NOT NULL,
    updated_at TEXT    NOT NULL,
    deleted_at TEXT                                 -- не NULL = заметка удалена (можно восстановить)
);

CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id, deleted_at);
