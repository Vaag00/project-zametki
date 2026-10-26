"""Пакеты, расписание, проверка заявки и тексты сообщений.

Пакеты и расписание — из content.json: при развёртывании туда копируется server/app/seed.json,
тот же файл, которым наполняется база на своём сервере. Сообщения об ошибках — как на сайте (shared/booking.ts).
"""
import json
import os
from datetime import date, datetime, timedelta, timezone
from html import escape
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONTENT_FILE = next(
    p for p in (HERE / "content.json", HERE.parent / "server" / "app" / "seed.json") if p.exists()
)
CONTENT = json.loads(CONTENT_FILE.read_text(encoding="utf-8"))
PACKAGES: list[dict] = CONTENT["packages"]
SCHEDULE: dict = CONTENT["schedule"]
SERIES: list[dict] = CONTENT.get("series", [])

SITE_URL = os.environ.get("SITE_URL", "https://vaag-ph.duckdns.org").rstrip("/")
OWNER_TELEGRAM = "vaaaaaag"
INSTAGRAM = "vaag.ph"
CHANNEL = "Vaag_ph"

# Съёмки в Петербурге, у Москвы нет перехода на летнее время
TZ = timezone(timedelta(hours=3))
LIMITS = {"name": 80, "contact": 100, "comment": 1000}
STATUS_RU = {"new": "новая", "confirmed": "подтверждена", "cancelled": "отменена"}
WEEKDAYS_RU = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"]
WEEKDAYS_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]
MONTHS_RU = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа",
             "сентября", "октября", "ноября", "декабря"]


def package(package_id: str | None) -> dict | None:
    return next((p for p in PACKAGES if p["id"] == package_id), None)


def today(now: datetime | None = None) -> date:
    return (now or datetime.now(TZ)).astimezone(TZ).date()


def booking_window(now: datetime | None = None) -> tuple[date, date]:
    t = today(now)
    return t + timedelta(days=SCHEDULE["min_lead_days"]), t + timedelta(days=SCHEDULE["horizon_days"])


def _js_weekday(d: date) -> int:
    """0 — воскресенье … 6 — суббота, как в JavaScript и в настройках."""
    return (d.weekday() + 1) % 7


def free_slots(taken: set[tuple[str, str]], closed: set[str], now: datetime | None = None) -> dict:
    """Свободные окошки по дням — в том же виде, что отдаёт сервер (/api/slots)."""
    first, last = booking_window(now)
    slots: dict[str, list[str]] = {}
    d = first
    while d <= last:
        ds = d.isoformat()
        if _js_weekday(d) in SCHEDULE["weekdays"] and ds not in closed:
            slots[ds] = [t for t in SCHEDULE["slot_times"] if (ds, t) not in taken]
        d += timedelta(days=1)
    return {"first": first.isoformat(), "last": last.isoformat(), "times": SCHEDULE["slot_times"], "slots": slots}


def validate_contact(b: dict) -> str | None:
    name = str(b.get("name") or "").strip()
    contact = str(b.get("contact") or "").strip()
    comment = str(b.get("comment") or "").strip()
    if not name:
        return "Напишите, как к вам обращаться."
    if len(name) > LIMITS["name"]:
        return "Имя слишком длинное."
    if len(contact) < 3:
        return "Оставьте Telegram или телефон, чтобы я мог ответить."
    if len(contact) > LIMITS["contact"]:
        return "Контакт слишком длинный."
    if len(comment) > LIMITS["comment"]:
        return f"Комментарий длиннее {LIMITS['comment']} символов."
    if b.get("consent") is not True:
        return "Отметьте согласие на обработку персональных данных."
    return None


def validate(b: dict, closed: set[str], now: datetime | None = None) -> str | None:
    """Текст ошибки для человека или None. Занятость окошка проверяет база."""
    if not package(b.get("packageId")):
        return "Выберите пакет."
    try:
        d = date.fromisoformat(b.get("date") or "")
    except (TypeError, ValueError):
        return "На эту дату запись недоступна."
    first, last = booking_window(now)
    if not (first <= d <= last) or _js_weekday(d) not in SCHEDULE["weekdays"] or d.isoformat() in closed:
        return "На эту дату запись недоступна."
    if b.get("time") not in SCHEDULE["slot_times"]:
        return "Выберите время."
    return validate_contact(b)


def parse_day(text: str, now: datetime | None = None) -> str | None:
    """«5.11», «05.11.2026» или «2026-11-05» → «2026-11-05». Без года — ближайшая такая дата."""
    text = text.strip()
    try:
        return date.fromisoformat(text).isoformat()
    except ValueError:
        pass
    parts = text.replace("/", ".").split(".")
    if len(parts) not in (2, 3) or not all(p.isdigit() for p in parts):
        return None
    t = today(now)
    day, month = int(parts[0]), int(parts[1])
    year = int(parts[2]) if len(parts) == 3 else t.year
    if year < 100:
        year += 2000
    try:
        d = date(year, month, day)
    except ValueError:
        return None
    if len(parts) == 2 and d < t:
        d = date(year + 1, month, day)
    return d.isoformat()


def format_date_ru(ds: str, with_year: bool = True) -> str:
    d = date.fromisoformat(ds)
    s = f"{WEEKDAYS_RU[d.weekday()]}, {d.day} {MONTHS_RU[d.month - 1]}"
    return f"{s} {d.year} г." if with_year else s


def format_date_short(ds: str) -> str:
    """«сб, 7 ноября» — для кнопок."""
    d = date.fromisoformat(ds)
    return f"{WEEKDAYS_SHORT[d.weekday()]}, {d.day} {MONTHS_RU[d.month - 1]}"


def format_price(n: int) -> str:
    return f"{n:,}".replace(",", " ") + " ₽"


def package_summary(p: dict) -> str:
    return " · ".join(x for x in (p.get("duration"), p.get("photos")) if x)


# ---------- Тексты (HTML-разметка Telegram) ----------

def owner_message(b: dict) -> str:
    """Сообщение фотографу о заявке."""
    contact = escape(b["contact"])
    if b.get("client_chat"):
        # Ссылка открывает чат с клиентом, даже если у него нет @username
        contact = f'<a href="tg://user?id={b["client_chat"]}">{contact}</a>'
    source = "через бота" if b.get("source") == "bot" else "с сайта"
    lines = [
        f"📸 <b>Заявка на съёмку</b> — {STATUS_RU[b['status']]}",
        "",
        f"Пакет: {escape(b['package_name'])} — {format_price(b['package_price'])}",
        f"Дата: {format_date_ru(b['date'])}",
        f"Время: {b['time']}",
        "",
        f"Имя: {escape(b['name'])}",
        f"Связь: {contact}",
    ]
    if b.get("comment"):
        lines += ["", f"Комментарий: {escape(b['comment'])}"]
    lines += ["", f"<i>Заявка {source}"
                  + (", клиент получит ответ в боте" if b.get("client_chat") else "") + "</i>"]
    return "\n".join(lines)


def client_message(b: dict) -> str:
    """Сообщение клиенту о статусе заявки."""
    when = f"{format_date_ru(b['date'], with_year=False)}, {b['time']}"
    if b["status"] == "confirmed":
        head = "✅ <b>Съёмка подтверждена</b>"
        tail = f"До встречи! Если планы изменятся — напишите мне: @{OWNER_TELEGRAM}"
    elif b["status"] == "cancelled":
        head = "<b>Заявка отменена</b>"
        tail = f"Если это ошибка или хотите выбрать другое время — напишите мне (@{OWNER_TELEGRAM}) или запишитесь снова: /book"
    else:
        head = "<b>Заявка получена</b>"
        tail = "Я посмотрю её и подтвержу съёмку — сообщение придёт сюда."
    return f"{head}\n\n{escape(b['package_name'])} · {when}\n\n{tail}"


def price_message() -> str:
    lines = ["💰 <b>Прайс</b>", ""]
    for p in PACKAGES:
        lines.append(f"<b>{escape(p['name'])}</b> — {format_price(p['price'])}")
        lines.append(escape(package_summary(p)))
        for f in p.get("features") or []:
            if f != p.get("duration") and f != f"{p.get('duration')} съёмки":
                lines.append(f"· {escape(f)}")
        lines.append("")
    lines.append(f'Свадьбы, события и скидки — <a href="{SITE_URL}/#price">на сайте</a>.')
    return "\n".join(lines)


def contacts_message() -> str:
    return (
        "✉️ <b>Контакты</b>\n\n"
        f"Telegram: @{OWNER_TELEGRAM}\n"
        f'Instagram: <a href="https://instagram.com/{INSTAGRAM}">@{INSTAGRAM}</a>\n'
        f"Канал: https://t.me/{CHANNEL}\n"
        f"Сайт: {SITE_URL}"
    )


def portfolio_photos() -> list[dict]:
    """Фото для альбома в боте: обложки серий и первые кадры, не больше 10 (лимит Telegram)."""
    out = []
    for s in SERIES:
        for ph in s.get("photos", []):
            out.append({"url": f"{SITE_URL}/portfolio/{ph['file']}.jpg", "caption": ph.get("alt", "")})
    return out[:10]
