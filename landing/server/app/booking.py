"""Расписание, проверка заявки и текст сообщения. Сообщения об ошибках — как на сайте (shared/booking.ts)."""
import sqlite3
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from .db import get_setting

TZ = ZoneInfo("Europe/Moscow")
LIMITS = {"name": 80, "contact": 100, "comment": 1000}
STATUS_RU = {"new": "новая", "confirmed": "подтверждена", "cancelled": "отменена"}
WEEKDAYS_RU = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"]
MONTHS_RU = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа",
             "сентября", "октября", "ноября", "декабря"]


def today(now: datetime | None = None) -> date:
    return (now or datetime.now(TZ)).astimezone(TZ).date()


def schedule(conn: sqlite3.Connection) -> dict:
    return get_setting(conn, "schedule")


def booking_window(sched: dict, now: datetime | None = None) -> tuple[date, date]:
    t = today(now)
    return t + timedelta(days=sched["min_lead_days"]), t + timedelta(days=sched["horizon_days"])


def _js_weekday(d: date) -> int:
    """0 — воскресенье … 6 — суббота, как в JavaScript и в настройках."""
    return (d.weekday() + 1) % 7


def free_slots(conn: sqlite3.Connection, now: datetime | None = None) -> dict:
    sched = schedule(conn)
    first, last = booking_window(sched, now)
    taken = {
        (r["date"], r["time"])
        for r in conn.execute(
            "SELECT date, time FROM bookings WHERE status != 'cancelled' AND date BETWEEN ? AND ?",
            (first.isoformat(), last.isoformat()),
        )
    }
    blocked = {(r["date"], r["time"]) for r in conn.execute("SELECT date, time FROM blocked")}
    slots: dict[str, list[str]] = {}
    d = first
    while d <= last:
        ds = d.isoformat()
        if _js_weekday(d) in sched["weekdays"] and (ds, "") not in blocked:
            slots[ds] = [t for t in sched["slot_times"] if (ds, t) not in taken and (ds, t) not in blocked]
        d += timedelta(days=1)
    return {"first": first.isoformat(), "last": last.isoformat(), "times": sched["slot_times"], "slots": slots}


def validate(conn: sqlite3.Connection, b: dict, now: datetime | None = None) -> str | None:
    """Текст ошибки для человека или None."""
    pkg = conn.execute("SELECT 1 FROM packages WHERE id = ? AND active = 1", (b.get("packageId"),)).fetchone()
    if not pkg:
        return "Выберите пакет."
    sched = schedule(conn)
    try:
        d = date.fromisoformat(b.get("date") or "")
    except ValueError:
        return "На эту дату запись недоступна."
    first, last = booking_window(sched, now)
    if not (first <= d <= last) or _js_weekday(d) not in sched["weekdays"]:
        return "На эту дату запись недоступна."
    if b.get("time") not in sched["slot_times"]:
        return "Выберите время."
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


def format_date_ru(ds: str, with_year: bool = True) -> str:
    d = date.fromisoformat(ds)
    s = f"{WEEKDAYS_RU[d.weekday()]}, {d.day} {MONTHS_RU[d.month - 1]}"
    return f"{s} {d.year} г." if with_year else s


def format_price(n: int) -> str:
    return f"{n:,}".replace(",", " ") + " ₽"


def owner_message(b: sqlite3.Row) -> str:
    """Сообщение фотографу о заявке."""
    lines = [
        f"📸 Заявка на съёмку #{b['id']} — {STATUS_RU[b['status']]}",
        "",
        f"Пакет: {b['package_name']} — {format_price(b['package_price'])}",
        f"Дата: {format_date_ru(b['date'])}",
        f"Время: {b['time']}",
        "",
        f"Имя: {b['name']}",
        f"Связь: {b['contact']}",
    ]
    if b["comment"]:
        lines += ["", f"Комментарий: {b['comment']}"]
    if b["client_chat_id"]:
        lines += ["", "🔔 Клиент подписан на уведомления бота"]
    return "\n".join(lines)


def client_message(b: sqlite3.Row) -> str:
    """Сообщение клиенту о статусе заявки."""
    when = f"{format_date_ru(b['date'], with_year=False)}, {b['time']}"
    if b["status"] == "confirmed":
        head = "✅ Съёмка подтверждена"
        tail = "До встречи! Если планы изменятся — напишите мне."
    elif b["status"] == "cancelled":
        head = "Заявка отменена"
        tail = "Если это ошибка или хотите выбрать другое время — напишите мне или запишитесь на сайте снова."
    else:
        head = "Заявка получена"
        tail = "Я посмотрю её и подтвержу съёмку — сообщение придёт сюда."
    return f"{head}\n\n{b['package_name']} · {when}\n\n{tail}"
