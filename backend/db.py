import os
import sqlite3
from pathlib import Path

DB_PATH = Path(os.environ.get("NOTES_DB", Path(__file__).parent / "notes.db"))

SCHEMA_PATH = Path(__file__).parent / "schema.sql"


def connect() -> sqlite3.Connection:
    # FastAPI может выполнить зависимость и обработчик в разных потоках пула
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    conn = connect()
    try:
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    finally:
        conn.close()


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
