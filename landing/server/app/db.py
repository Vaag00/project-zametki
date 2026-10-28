"""SQLite: подключение, схема, первичное наполнение."""
import json
import shutil
import sqlite3
from pathlib import Path

from PIL import Image

from .config import settings

HERE = Path(__file__).resolve().parent


def connect() -> sqlite3.Connection:
    # FastAPI может выполнить зависимость и обработчик в разных потоках пула
    conn = sqlite3.connect(settings.db_path, check_same_thread=False, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def get_db():
    """Зависимость FastAPI: одно соединение на запрос, коммит при успехе."""
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.media_dir.mkdir(parents=True, exist_ok=True)
    conn = connect()
    try:
        conn.executescript((HERE / "schema.sql").read_text(encoding="utf-8"))
        _seed(conn)
        conn.commit()
    finally:
        conn.close()


def get_setting(conn: sqlite3.Connection, key: str):
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return json.loads(row["value"]) if row else None


def set_setting(conn: sqlite3.Connection, key: str, value) -> None:
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, json.dumps(value, ensure_ascii=False)),
    )


def _seed(conn: sqlite3.Connection) -> None:
    """Первый запуск: расписание, пакеты и портфолио по умолчанию. Дальше всё меняется в админке."""
    seed = json.loads((HERE / "seed.json").read_text(encoding="utf-8"))

    if get_setting(conn, "schedule") is None:
        set_setting(conn, "schedule", seed["schedule"])

    if not conn.execute("SELECT 1 FROM packages LIMIT 1").fetchone():
        for pos, p in enumerate(seed["packages"]):
            conn.execute(
                "INSERT INTO packages (id, position, name, duration, photos, price, tagline, features, note)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (p["id"], pos, p["name"], p["duration"], p["photos"], p["price"], p["tagline"],
                 json.dumps(p["features"], ensure_ascii=False), p["note"]),
            )

    if not conn.execute("SELECT 1 FROM series LIMIT 1").fetchone():
        for pos, s in enumerate(seed["series"]):
            conn.execute(
                "INSERT INTO series (id, position, title, description) VALUES (?, ?, ?, ?)",
                (s["id"], pos, s["title"], s["description"]),
            )
            for ppos, ph in enumerate(s["photos"]):
                src = settings.seed_dir / f"{ph['file']}.jpg"
                src_sm = settings.seed_dir / f"{ph['file']}-sm.jpg"
                if not (src.exists() and src_sm.exists()):
                    continue  # нет файлов — пропускаем, фото можно загрузить в админке
                shutil.copyfile(src, settings.media_dir / src.name)
                shutil.copyfile(src_sm, settings.media_dir / src_sm.name)
                with Image.open(src) as im:
                    w, h = im.size
                conn.execute(
                    "INSERT INTO photos (series_id, position, file, w, h, alt) VALUES (?, ?, ?, ?, ?, ?)",
                    (s["id"], ppos, ph["file"], w, h, ph["alt"]),
                )
