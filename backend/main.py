import json
import os
import re
import sqlite3
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from . import security
from .db import get_db, init_db

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
SESSION_COOKIE = "session"
SESSION_TTL = timedelta(days=30)
# Включите COOKIE_SECURE=1, когда сайт работает по HTTPS
COOKIE_SECURE = os.environ.get("COOKIE_SECURE") == "1"

Color = Literal["default", "yellow", "green", "blue", "pink", "purple"]
USERNAME_RE = re.compile(r"^[\w.-]{3,30}$")  # буквы (в т.ч. русские), цифры, _ . -


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Notes API", lifespan=lifespan)


@app.exception_handler(RequestValidationError)
async def validation_error(_request: Request, exc: RequestValidationError):
    # Отдаём фронту одно понятное сообщение вместо списка ошибок pydantic
    err = exc.errors()[0] if exc.errors() else {}
    msg = err.get("msg", "")
    msg = msg.removeprefix("Value error, ") if err.get("type") == "value_error" else "Некорректные данные"
    return JSONResponse(status_code=422, content={"detail": msg})


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


# ---------- Схемы ----------

class RegisterIn(BaseModel):
    username: str
    password: str

    @field_validator("username")
    @classmethod
    def check_username(cls, v: str) -> str:
        v = v.strip()
        if not USERNAME_RE.match(v):
            raise ValueError("Логин: от 3 до 30 символов — буквы, цифры, «_», «.» или «-»")
        return v

    @field_validator("password")
    @classmethod
    def check_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Пароль должен быть не короче 8 символов")
        if len(v) > 128:
            raise ValueError("Пароль слишком длинный")
        return v


class LoginIn(BaseModel):
    username: str = Field(max_length=30)
    password: str = Field(max_length=128)


class NoteIn(BaseModel):
    title: str = Field("", max_length=120)
    body: str = Field("", max_length=20000)
    tags: list[str] = Field(default_factory=list, max_length=20)
    color: Color = "default"
    pinned: bool = False
    archived: bool = False

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, v: list[str]) -> list[str]:
        seen = []
        for t in v:
            t = t.strip().lower()[:30]
            if t and t not in seen:
                seen.append(t)
        return seen


class NotePatch(NoteIn):
    # Те же поля и проверки, но в PATCH передаются только изменённые
    pass


# ---------- Вспомогательное ----------

def user_out(row: sqlite3.Row) -> dict:
    return {"id": row["id"], "username": row["username"]}


def note_out(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "body": row["body"],
        "tags": json.loads(row["tags"]),
        "color": row["color"],
        "pinned": bool(row["pinned"]),
        "archived": bool(row["archived"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def start_session(db: sqlite3.Connection, response: Response, user_id: int) -> None:
    token = security.new_session_token()
    expires = datetime.now(timezone.utc) + SESSION_TTL
    db.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
        (security.hash_token(token), user_id, expires.isoformat()),
    )
    response.set_cookie(
        SESSION_COOKIE, token,
        max_age=int(SESSION_TTL.total_seconds()),
        httponly=True, samesite="lax", secure=COOKIE_SECURE, path="/",
    )


def current_user(request: Request, db: sqlite3.Connection = Depends(get_db)) -> sqlite3.Row:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        row = db.execute(
            """SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
               WHERE s.token_hash = ?""",
            (security.hash_token(token),),
        ).fetchone()
        if row and row["expires_at"] > datetime.now(timezone.utc).isoformat():
            return row
    raise HTTPException(401, "Требуется вход")


def get_note(db: sqlite3.Connection, user_id: int, note_id: str, deleted: bool = False) -> sqlite3.Row:
    row = db.execute(
        f"SELECT * FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS {'NOT ' if deleted else ''}NULL",
        (note_id, user_id),
    ).fetchone()
    if not row:
        raise HTTPException(404, "Заметка не найдена")
    return row


# ---------- Авторизация ----------

@app.post("/api/auth/register", status_code=201)
def register(data: RegisterIn, response: Response, db: sqlite3.Connection = Depends(get_db)):
    if db.execute("SELECT 1 FROM users WHERE username_key = ?", (data.username.casefold(),)).fetchone():
        raise HTTPException(409, "Этот логин уже занят")
    now = now_iso()
    cur = db.execute(
        "INSERT INTO users (username, username_key, password_hash, created_at) VALUES (?, ?, ?, ?)",
        (data.username, data.username.casefold(), security.hash_password(data.password), now),
    )
    user_id = cur.lastrowid
    db.execute(
        """INSERT INTO notes (id, user_id, title, body, tags, color, pinned, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'yellow', 1, ?, ?)""",
        (
            uuid.uuid4().hex, user_id, "Добро пожаловать 👋",
            "Нажмите на заметку, чтобы её отредактировать.\n\n"
            "Горячие клавиши:\nN — новая заметка\n/ — поиск\n⌘/Ctrl + Enter — сохранить",
            json.dumps(["инструкция"], ensure_ascii=False), now, now,
        ),
    )
    start_session(db, response, user_id)
    return user_out(db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())


@app.post("/api/auth/login")
def login(data: LoginIn, response: Response, db: sqlite3.Connection = Depends(get_db)):
    user = db.execute("SELECT * FROM users WHERE username_key = ?", (data.username.strip().casefold(),)).fetchone()
    ok = security.verify_password(data.password, user["password_hash"] if user else security.DUMMY_HASH)
    if not (user and ok):
        raise HTTPException(401, "Неверный логин или пароль")
    # Заодно чистим просроченные сессии пользователя
    db.execute("DELETE FROM sessions WHERE user_id = ? AND expires_at < ?", (user["id"], now_iso()))
    start_session(db, response, user["id"])
    return user_out(user)


@app.post("/api/auth/logout", status_code=204)
def logout(request: Request, response: Response, db: sqlite3.Connection = Depends(get_db)):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        db.execute("DELETE FROM sessions WHERE token_hash = ?", (security.hash_token(token),))
    response.delete_cookie(SESSION_COOKIE, path="/")


@app.get("/api/auth/me")
def me(user: sqlite3.Row = Depends(current_user)):
    return user_out(user)


# ---------- Заметки ----------

@app.get("/api/notes")
def list_notes(user=Depends(current_user), db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute(
        "SELECT * FROM notes WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC",
        (user["id"],),
    ).fetchall()
    return [note_out(r) for r in rows]


@app.post("/api/notes", status_code=201)
def create_note(data: NoteIn, user=Depends(current_user), db: sqlite3.Connection = Depends(get_db)):
    note_id, now = uuid.uuid4().hex, now_iso()
    db.execute(
        """INSERT INTO notes (id, user_id, title, body, tags, color, pinned, archived, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (note_id, user["id"], data.title, data.body, json.dumps(data.tags, ensure_ascii=False),
         data.color, int(data.pinned), int(data.archived), now, now),
    )
    return note_out(get_note(db, user["id"], note_id))


@app.patch("/api/notes/{note_id}")
def update_note(note_id: str, data: NotePatch, user=Depends(current_user),
                db: sqlite3.Connection = Depends(get_db)):
    get_note(db, user["id"], note_id)
    changes = data.model_dump(exclude_unset=True)
    if "tags" in changes:
        changes["tags"] = json.dumps(changes["tags"], ensure_ascii=False)
    for key in ("pinned", "archived"):
        if key in changes:
            changes[key] = int(changes[key])
    changes["updated_at"] = now_iso()
    # Имена колонок берутся только из полей схемы, поэтому f-строка безопасна
    sets = ", ".join(f"{k} = ?" for k in changes)
    db.execute(f"UPDATE notes SET {sets} WHERE id = ? AND user_id = ?",
               (*changes.values(), note_id, user["id"]))
    return note_out(get_note(db, user["id"], note_id))


@app.delete("/api/notes/{note_id}", status_code=204)
def delete_note(note_id: str, user=Depends(current_user), db: sqlite3.Connection = Depends(get_db)):
    get_note(db, user["id"], note_id)
    # Мягкое удаление — чтобы работала кнопка «Отменить»
    db.execute("UPDATE notes SET deleted_at = ? WHERE id = ?", (now_iso(), note_id))


@app.post("/api/notes/{note_id}/restore")
def restore_note(note_id: str, user=Depends(current_user), db: sqlite3.Connection = Depends(get_db)):
    get_note(db, user["id"], note_id, deleted=True)
    db.execute("UPDATE notes SET deleted_at = NULL WHERE id = ?", (note_id,))
    return note_out(get_note(db, user["id"], note_id))


# Фронтенд отдаётся тем же сервером — монтируем последним, после /api
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
