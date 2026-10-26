"""Сервер сайта VAAAAAAG: запись на съёмку, админка, портфолио и прайс.

Публичное API — /api/…, админка — /api/admin/… (вход по паролю, cookie-сессия).
Собранный сайт и загруженные фото отдаёт этот же сервер (STATIC_DIR, /media).
"""
import hashlib
import hmac
import json
import logging
import re
import secrets
import sqlite3
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import Body, Cookie, Depends, FastAPI, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import booking, media, telegram
from .config import settings
from .db import get_db, init_db, set_setting

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("vaag")

SESSION_COOKIE = "vaag_admin"
SESSION_DAYS = 30
MAX_BOOKINGS_PER_HOUR = 3
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
ID_RE = re.compile(r"^[a-z0-9-]{1,40}$")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    poller = None
    if settings.telegram_token and settings.telegram_polling:
        poller = telegram.Poller()
        poller.start()
    elif not settings.telegram_token:
        log.warning("TELEGRAM_BOT_TOKEN не задан — заявки будут только в админке")
    if not settings.admin_password:
        log.warning("ADMIN_PASSWORD не задан — вход в админку отключён")
    yield
    if poller:
        poller.stop()


app = FastAPI(title="VAAAAAAG", lifespan=lifespan, docs_url=None, redoc_url=None)


def err(status: int, message: str):
    raise HTTPException(status_code=status, detail=message)


# ---------- Публичное API ----------


def package_out(r: sqlite3.Row) -> dict:
    return {
        "id": r["id"], "name": r["name"], "duration": r["duration"], "photos": r["photos"] or None,
        "price": r["price"], "tagline": r["tagline"] or None, "features": json.loads(r["features"]),
        "note": r["note"] or None, "active": bool(r["active"]),
    }


def photo_out(r: sqlite3.Row) -> dict:
    return {
        "id": r["id"], "src": f"/media/{r['file']}.jpg", "srcSm": f"/media/{r['file']}-sm.jpg",
        "w": r["w"], "h": r["h"], "alt": r["alt"],
    }


def series_out(conn: sqlite3.Connection, include_empty: bool) -> list[dict]:
    out = []
    for s in conn.execute("SELECT * FROM series ORDER BY position, rowid"):
        photos = [photo_out(p) for p in conn.execute(
            "SELECT * FROM photos WHERE series_id = ? ORDER BY position, id", (s["id"],))]
        if photos or include_empty:
            out.append({"id": s["id"], "title": s["title"], "description": s["description"], "photos": photos})
    return out


@app.get("/api/content")
def content(conn: sqlite3.Connection = Depends(get_db)):
    """Всё, что сайт показывает из базы: пакеты, портфолио, имя бота."""
    return {
        "packages": [package_out(r) for r in conn.execute(
            "SELECT * FROM packages WHERE active = 1 ORDER BY position, rowid")],
        "series": series_out(conn, include_empty=False),
        "telegramBot": telegram.tg.username,
    }


@app.get("/api/slots")
def slots(conn: sqlite3.Connection = Depends(get_db)):
    return booking.free_slots(conn)


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@app.post("/api/bookings", status_code=201)
def create_booking(request: Request, body: dict = Body(...), conn: sqlite3.Connection = Depends(get_db)):
    if body.get("website"):
        # Ловушка для ботов: делаем вид, что всё хорошо, но ничего не сохраняем
        return {"ok": True, "token": None}
    if problem := booking.validate(conn, body):
        err(400, problem)

    ip_hash = hashlib.sha256(client_ip(request).encode()).hexdigest()
    recent = conn.execute(
        "SELECT COUNT(*) FROM bookings WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')", (ip_hash,)
    ).fetchone()[0]
    if recent >= MAX_BOOKINGS_PER_HOUR:
        err(429, "Слишком много заявок подряд. Напишите мне в Telegram.")

    if body["time"] not in booking.free_slots(conn)["slots"].get(body["date"], []):
        err(409, "Это время только что заняли. Выберите другое.")

    pkg = conn.execute("SELECT name, price FROM packages WHERE id = ?", (body["packageId"],)).fetchone()
    token = secrets.token_urlsafe(16)
    try:
        cur = conn.execute(
            "INSERT INTO bookings (token, package_id, package_name, package_price, date, time, name, contact,"
            " comment, ip_hash, consent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
            (token, body["packageId"], pkg["name"], pkg["price"], body["date"], body["time"],
             str(body["name"]).strip(), str(body["contact"]).strip(), str(body.get("comment") or "").strip(), ip_hash),
        )
    except sqlite3.IntegrityError:
        err(409, "Это время только что заняли. Выберите другое.")
    conn.commit()
    # Если Telegram сейчас недоступен — заявка всё равно сохранена, бот повторит отправку
    telegram.notify_owner(conn, cur.lastrowid)
    return {"ok": True, "token": token}


@app.get("/api/bookings/{token}")
def booking_status(token: str, conn: sqlite3.Connection = Depends(get_db)):
    b = conn.execute("SELECT * FROM bookings WHERE token = ?", (token,)).fetchone()
    if b is None:
        err(404, "Заявка не найдена.")
    return {
        "status": b["status"], "packageName": b["package_name"], "packagePrice": b["package_price"],
        "date": b["date"], "time": b["time"], "name": b["name"], "subscribed": b["client_chat_id"] is not None,
        "telegramBot": telegram.tg.username,
    }


# ---------- Админка: вход ----------

_login_attempts: dict[str, deque] = defaultdict(deque)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@app.post("/api/admin/login")
def login(request: Request, response: Response, body: dict = Body(...), conn: sqlite3.Connection = Depends(get_db)):
    if not settings.admin_password:
        err(503, "Пароль админки не задан на сервере (ADMIN_PASSWORD).")
    attempts = _login_attempts[client_ip(request)]
    now = time.monotonic()
    while attempts and now - attempts[0] > 300:
        attempts.popleft()
    if len(attempts) >= 5:
        err(429, "Слишком много попыток. Подождите 5 минут.")
    attempts.append(now)
    if not hmac.compare_digest(str(body.get("password", "")).encode(), settings.admin_password.encode()):
        err(401, "Неверный пароль.")
    attempts.clear()
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
    conn.execute("DELETE FROM sessions WHERE expires_at < datetime('now')")
    conn.execute("INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)",
                 (_hash_token(token), expires.strftime("%Y-%m-%d %H:%M:%S")))
    response.set_cookie(SESSION_COOKIE, token, max_age=SESSION_DAYS * 86400, httponly=True,
                        samesite="strict", secure=settings.cookie_secure, path="/api/admin")
    return {"ok": True}


def require_admin(vaag_admin: str | None = Cookie(default=None), conn: sqlite3.Connection = Depends(get_db)):
    if not vaag_admin or not conn.execute(
        "SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at > datetime('now')", (_hash_token(vaag_admin),)
    ).fetchone():
        err(401, "Нужно войти.")
    return conn


@app.post("/api/admin/logout")
def logout(response: Response, vaag_admin: str | None = Cookie(default=None), conn: sqlite3.Connection = Depends(get_db)):
    if vaag_admin:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_hash_token(vaag_admin),))
    response.delete_cookie(SESSION_COOKIE, path="/api/admin")
    return {"ok": True}


@app.get("/api/admin/me")
def me(conn: sqlite3.Connection = Depends(require_admin)):
    return {
        "ok": True,
        "telegram": {
            "bot": telegram.tg.username,
            "tokenSet": bool(settings.telegram_token),
            "ownerChatSet": settings.telegram_owner_chat_id is not None,
        },
    }


# ---------- Админка: заявки ----------


def booking_out(b: sqlite3.Row) -> dict:
    return {
        "id": b["id"], "status": b["status"], "packageId": b["package_id"], "packageName": b["package_name"],
        "packagePrice": b["package_price"], "date": b["date"], "time": b["time"], "name": b["name"],
        "contact": b["contact"], "comment": b["comment"], "subscribed": b["client_chat_id"] is not None,
        "notified": b["owner_message_id"] is not None, "createdAt": b["created_at"],
    }


@app.get("/api/admin/bookings")
def list_bookings(scope: str = "upcoming", conn: sqlite3.Connection = Depends(require_admin)):
    today = booking.today().isoformat()
    if scope == "upcoming":
        rows = conn.execute("SELECT * FROM bookings WHERE date >= ? ORDER BY date, time", (today,))
    elif scope == "past":
        rows = conn.execute("SELECT * FROM bookings WHERE date < ? ORDER BY date DESC, time DESC", (today,))
    else:
        rows = conn.execute("SELECT * FROM bookings ORDER BY date DESC, time DESC")
    return [booking_out(b) for b in rows]


@app.patch("/api/admin/bookings/{booking_id}")
def update_booking(booking_id: int, body: dict = Body(...), conn: sqlite3.Connection = Depends(require_admin)):
    status = body.get("status")
    if status not in ("new", "confirmed", "cancelled"):
        err(400, "Неизвестный статус.")
    try:
        b = telegram.set_status(conn, booking_id, status)
    except ValueError as e:
        err(409, str(e))
    if b is None:
        err(404, "Заявка не найдена.")
    return booking_out(b)


@app.delete("/api/admin/bookings/{booking_id}")
def delete_booking(booking_id: int, conn: sqlite3.Connection = Depends(require_admin)):
    """Полное удаление (например, по просьбе клиента удалить его данные)."""
    if conn.execute("DELETE FROM bookings WHERE id = ?", (booking_id,)).rowcount == 0:
        err(404, "Заявка не найдена.")
    return {"ok": True}


# ---------- Админка: расписание ----------


@app.get("/api/admin/schedule")
def get_schedule(conn: sqlite3.Connection = Depends(require_admin)):
    blocked = [dict(r) for r in conn.execute("SELECT date, time FROM blocked WHERE date >= ? ORDER BY date, time",
                                             (booking.today().isoformat(),))]
    return {**booking.schedule(conn), "blocked": blocked}


@app.put("/api/admin/schedule")
def put_schedule(body: dict = Body(...), conn: sqlite3.Connection = Depends(require_admin)):
    times = body.get("slot_times")
    if not isinstance(times, list) or not times or not all(isinstance(t, str) and TIME_RE.match(t) for t in times):
        err(400, "Время окошек — в формате ЧЧ:ММ, хотя бы одно.")
    weekdays = body.get("weekdays")
    if not isinstance(weekdays, list) or not all(isinstance(d, int) and 0 <= d <= 6 for d in weekdays):
        err(400, "Дни недели указаны неверно.")
    lead, horizon = body.get("min_lead_days"), body.get("horizon_days")
    if not (isinstance(lead, int) and 0 <= lead <= 30):
        err(400, "Минимальный срок записи — от 0 до 30 дней.")
    if not (isinstance(horizon, int) and 7 <= horizon <= 365 and horizon > lead):
        err(400, "Запись вперёд — от 7 до 365 дней.")
    sched = {"slot_times": sorted(set(times)), "weekdays": sorted(set(weekdays)),
             "min_lead_days": lead, "horizon_days": horizon}
    set_setting(conn, "schedule", sched)
    return sched


@app.post("/api/admin/blocked")
def add_blocked(body: dict = Body(...), conn: sqlite3.Connection = Depends(require_admin)):
    d, t = str(body.get("date") or ""), str(body.get("time") or "")
    try:
        datetime.strptime(d, "%Y-%m-%d")
    except ValueError:
        err(400, "Дата в формате ГГГГ-ММ-ДД.")
    if t and not TIME_RE.match(t):
        err(400, "Время в формате ЧЧ:ММ.")
    conn.execute("INSERT OR IGNORE INTO blocked (date, time) VALUES (?, ?)", (d, t))
    return {"ok": True}


@app.delete("/api/admin/blocked")
def remove_blocked(date: str, time: str = "", conn: sqlite3.Connection = Depends(require_admin)):
    conn.execute("DELETE FROM blocked WHERE date = ? AND time = ?", (date, time))
    return {"ok": True}


# ---------- Админка: пакеты (прайс) ----------


def _package_fields(body: dict) -> tuple:
    name = str(body.get("name") or "").strip()
    if not name:
        err(400, "У пакета должно быть название.")
    price = body.get("price")
    if not isinstance(price, int) or price < 0:
        err(400, "Цена — целое число рублей.")
    features = body.get("features") or []
    if not isinstance(features, list) or not all(isinstance(f, str) for f in features):
        err(400, "«Что входит» — список строк.")
    return (name, str(body.get("duration") or "").strip(), str(body.get("photos") or "").strip(), price,
            str(body.get("tagline") or "").strip(),
            json.dumps([f.strip() for f in features if f.strip()], ensure_ascii=False),
            str(body.get("note") or "").strip(), 1 if body.get("active", True) else 0)


@app.get("/api/admin/packages")
def admin_packages(conn: sqlite3.Connection = Depends(require_admin)):
    return [package_out(r) for r in conn.execute("SELECT * FROM packages ORDER BY position, rowid")]


@app.post("/api/admin/packages", status_code=201)
def create_package(body: dict = Body(...), conn: sqlite3.Connection = Depends(require_admin)):
    pid = str(body.get("id") or "").strip().lower() or f"p-{secrets.token_hex(3)}"
    if not ID_RE.match(pid):
        err(400, "Код пакета — латиница, цифры и дефис.")
    pos = conn.execute("SELECT COALESCE(MAX(position), -1) + 1 FROM packages").fetchone()[0]
    try:
        conn.execute("INSERT INTO packages (id, position, name, duration, photos, price, tagline, features, note, active)"
                     " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (pid, pos, *_package_fields(body)))
    except sqlite3.IntegrityError:
        err(409, "Пакет с таким кодом уже есть.")
    return package_out(conn.execute("SELECT * FROM packages WHERE id = ?", (pid,)).fetchone())


@app.put("/api/admin/packages/{package_id}")
def update_package(package_id: str, body: dict = Body(...), conn: sqlite3.Connection = Depends(require_admin)):
    cur = conn.execute("UPDATE packages SET name = ?, duration = ?, photos = ?, price = ?, tagline = ?, features = ?,"
                       " note = ?, active = ? WHERE id = ?", (*_package_fields(body), package_id))
    if cur.rowcount == 0:
        err(404, "Пакет не найден.")
    return package_out(conn.execute("SELECT * FROM packages WHERE id = ?", (package_id,)).fetchone())


@app.delete("/api/admin/packages/{package_id}")
def delete_package(package_id: str, conn: sqlite3.Connection = Depends(require_admin)):
    # Прошлые заявки хранят снимок названия и цены, поэтому пакет можно удалить
    if conn.execute("DELETE FROM packages WHERE id = ?", (package_id,)).rowcount == 0:
        err(404, "Пакет не найден.")
    return {"ok": True}


def _reorder(conn: sqlite3.Connection, table: str, ids: list, where: str = "", params: tuple = ()) -> None:
    for pos, item_id in enumerate(ids):
        conn.execute(f"UPDATE {table} SET position = ? WHERE id = ?{where}", (pos, item_id, *params))


@app.post("/api/admin/packages/reorder")
def reorder_packages(body: dict = Body(...), conn: sqlite3.Connection = Depends(require_admin)):
    _reorder(conn, "packages", body.get("ids") or [])
    return {"ok": True}


# ---------- Админка: портфолио ----------


@app.get("/api/admin/series")
def admin_series(conn: sqlite3.Connection = Depends(require_admin)):
    return series_out(conn, include_empty=True)


@app.post("/api/admin/series", status_code=201)
def create_series(body: dict = Body(...), conn: sqlite3.Connection = Depends(require_admin)):
    title = str(body.get("title") or "").strip()
    if not title:
        err(400, "У серии должно быть название.")
    sid = f"s-{secrets.token_hex(3)}"
    pos = conn.execute("SELECT COALESCE(MAX(position), -1) + 1 FROM series").fetchone()[0]
    conn.execute("INSERT INTO series (id, position, title, description) VALUES (?, ?, ?, ?)",
                 (sid, pos, title, str(body.get("description") or "").strip()))
    return {"id": sid, "title": title, "description": str(body.get("description") or "").strip(), "photos": []}


@app.put("/api/admin/series/{series_id}")
def update_series(series_id: str, body: dict = Body(...), conn: sqlite3.Connection = Depends(require_admin)):
    title = str(body.get("title") or "").strip()
    if not title:
        err(400, "У серии должно быть название.")
    if conn.execute("UPDATE series SET title = ?, description = ? WHERE id = ?",
                    (title, str(body.get("description") or "").strip(), series_id)).rowcount == 0:
        err(404, "Серия не найдена.")
    return {"ok": True}


@app.delete("/api/admin/series/{series_id}")
def delete_series(series_id: str, conn: sqlite3.Connection = Depends(require_admin)):
    files = [r["file"] for r in conn.execute("SELECT file FROM photos WHERE series_id = ?", (series_id,))]
    if conn.execute("DELETE FROM series WHERE id = ?", (series_id,)).rowcount == 0:
        err(404, "Серия не найдена.")
    conn.commit()
    for f in files:
        media.delete_photo_files(f)
    return {"ok": True}


@app.post("/api/admin/series/reorder")
def reorder_series(body: dict = Body(...), conn: sqlite3.Connection = Depends(require_admin)):
    _reorder(conn, "series", body.get("ids") or [])
    return {"ok": True}


@app.post("/api/admin/series/{series_id}/photos", status_code=201)
async def upload_photos(series_id: str, files: list[UploadFile] = File(...),
                        conn: sqlite3.Connection = Depends(require_admin)):
    s = conn.execute("SELECT title FROM series WHERE id = ?", (series_id,)).fetchone()
    if s is None:
        err(404, "Серия не найдена.")
    pos = conn.execute("SELECT COALESCE(MAX(position), -1) + 1 FROM photos WHERE series_id = ?", (series_id,)).fetchone()[0]
    added, errors = [], []
    for f in files:
        try:
            name, w, h = media.save_photo(await f.read(media.MAX_UPLOAD_BYTES + 1))
        except media.BadImage as e:
            errors.append(f"{f.filename}: {e}")
            continue
        cur = conn.execute("INSERT INTO photos (series_id, position, file, w, h, alt) VALUES (?, ?, ?, ?, ?, ?)",
                           (series_id, pos, name, w, h, s["title"]))
        pos += 1
        added.append(photo_out(conn.execute("SELECT * FROM photos WHERE id = ?", (cur.lastrowid,)).fetchone()))
    return {"added": added, "errors": errors}


@app.patch("/api/admin/photos/{photo_id}")
def update_photo(photo_id: int, body: dict = Body(...), conn: sqlite3.Connection = Depends(require_admin)):
    if conn.execute("UPDATE photos SET alt = ? WHERE id = ?",
                    (str(body.get("alt") or "").strip(), photo_id)).rowcount == 0:
        err(404, "Фото не найдено.")
    return {"ok": True}


@app.delete("/api/admin/photos/{photo_id}")
def delete_photo(photo_id: int, conn: sqlite3.Connection = Depends(require_admin)):
    row = conn.execute("SELECT file FROM photos WHERE id = ?", (photo_id,)).fetchone()
    if row is None:
        err(404, "Фото не найдено.")
    conn.execute("DELETE FROM photos WHERE id = ?", (photo_id,))
    conn.commit()
    media.delete_photo_files(row["file"])
    return {"ok": True}


@app.post("/api/admin/series/{series_id}/photos/reorder")
def reorder_photos(series_id: str, body: dict = Body(...), conn: sqlite3.Connection = Depends(require_admin)):
    _reorder(conn, "photos", body.get("ids") or [], " AND series_id = ?", (series_id,))
    return {"ok": True}


# ---------- Файлы: фото и собранный сайт ----------

settings.media_dir.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=settings.media_dir), name="media")

if settings.static_dir and settings.static_dir.is_dir():
    index_html = settings.static_dir / "index.html"

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(index_html, headers={"Cache-Control": "no-cache"})

    app.mount("/", StaticFiles(directory=settings.static_dir), name="site")
