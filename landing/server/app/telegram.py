"""Telegram-бот: заявки фотографу с кнопками, уведомления клиентам.

Сообщения бот получает через getUpdates (long polling) в отдельном потоке —
так не нужен публичный адрес для вебхука, и всё работает за обычным HTTPS.
"""
import logging
import sqlite3
import threading

import httpx

from . import booking
from .config import settings
from .db import connect

log = logging.getLogger("vaag.telegram")


class Telegram:
    def __init__(self, client: httpx.Client | None = None):
        self.client = client or httpx.Client(timeout=40)
        self.username: str | None = None

    @property
    def enabled(self) -> bool:
        return bool(settings.telegram_token)

    def call(self, method: str, **params):
        """Вызов Bot API. Возвращает result или None при ошибке (ошибка пишется в лог)."""
        if not self.enabled:
            return None
        try:
            r = self.client.post(f"{settings.telegram_api}/bot{settings.telegram_token}/{method}", json=params)
            data = r.json()
        except (httpx.HTTPError, ValueError) as err:
            log.warning("Telegram %s: %s", method, err)
            return None
        if not data.get("ok"):
            log.warning("Telegram %s: %s", method, data.get("description"))
            return None
        return data["result"]

    def send(self, chat_id: int, text: str, buttons: list | None = None) -> int | None:
        params = {"chat_id": chat_id, "text": text, "disable_web_page_preview": True}
        if buttons is not None:
            params["reply_markup"] = {"inline_keyboard": buttons}
        res = self.call("sendMessage", **params)
        return res["message_id"] if res else None

    def edit(self, chat_id: int, message_id: int, text: str, buttons: list | None = None) -> None:
        self.call(
            "editMessageText",
            chat_id=chat_id,
            message_id=message_id,
            text=text,
            disable_web_page_preview=True,
            reply_markup={"inline_keyboard": buttons or []},
        )

    def fetch_username(self) -> str | None:
        me = self.call("getMe")
        self.username = me["username"] if me else None
        return self.username


tg = Telegram()


def owner_buttons(b: sqlite3.Row) -> list:
    if b["status"] == "new":
        return [[{"text": "✅ Подтвердить", "callback_data": f"c:{b['id']}"},
                 {"text": "✖️ Отменить", "callback_data": f"x:{b['id']}"}]]
    if b["status"] == "confirmed":
        return [[{"text": "✖️ Отменить", "callback_data": f"x:{b['id']}"}]]
    return []


def get_booking(conn: sqlite3.Connection, booking_id: int) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM bookings WHERE id = ?", (booking_id,)).fetchone()


def notify_owner(conn: sqlite3.Connection, booking_id: int) -> bool:
    """Отправить фотографу сообщение о новой заявке. False — не получилось (повторим позже)."""
    if settings.telegram_owner_chat_id is None:
        return False
    b = get_booking(conn, booking_id)
    msg_id = tg.send(settings.telegram_owner_chat_id, booking.owner_message(b), owner_buttons(b))
    if msg_id is None:
        return False
    conn.execute("UPDATE bookings SET owner_message_id = ? WHERE id = ?", (msg_id, booking_id))
    return True


def refresh_owner_message(conn: sqlite3.Connection, booking_id: int) -> None:
    b = get_booking(conn, booking_id)
    if b and b["owner_message_id"] and settings.telegram_owner_chat_id is not None:
        tg.edit(settings.telegram_owner_chat_id, b["owner_message_id"], booking.owner_message(b), owner_buttons(b))


def set_status(conn: sqlite3.Connection, booking_id: int, status: str) -> sqlite3.Row | None:
    """Сменить статус заявки (из админки или кнопкой в Telegram) и всех оповестить."""
    b = get_booking(conn, booking_id)
    if b is None:
        return None
    if b["status"] == status:
        return b
    if b["status"] == "cancelled":
        # Окошко могли уже занять — восстановить отменённую заявку нельзя
        raise ValueError("Отменённую заявку нельзя вернуть — попросите клиента записаться снова.")
    conn.execute("UPDATE bookings SET status = ?, updated_at = datetime('now') WHERE id = ?", (status, booking_id))
    b = get_booking(conn, booking_id)
    refresh_owner_message(conn, booking_id)
    if b["client_chat_id"]:
        tg.send(b["client_chat_id"], booking.client_message(b))
    return b


def handle_update(conn: sqlite3.Connection, upd: dict) -> None:
    """Одно обновление от Telegram: нажатие кнопки или сообщение боту."""
    if cq := upd.get("callback_query"):
        chat_id = cq.get("message", {}).get("chat", {}).get("id")
        text = "Готово"
        if chat_id != settings.telegram_owner_chat_id:
            text = "Эти кнопки только для фотографа."
        else:
            action, _, raw_id = (cq.get("data") or "").partition(":")
            status = {"c": "confirmed", "x": "cancelled"}.get(action)
            if status and raw_id.isdigit():
                try:
                    b = set_status(conn, int(raw_id), status)
                    text = "Заявка не найдена" if b is None else f"Заявка #{raw_id}: {booking.STATUS_RU[status]}"
                except ValueError as err:
                    text = str(err)
        tg.call("answerCallbackQuery", callback_query_id=cq["id"], text=text)
        return

    msg = upd.get("message") or {}
    chat_id = msg.get("chat", {}).get("id")
    text = (msg.get("text") or "").strip()
    if chat_id is None:
        return

    if text.startswith("/start b_"):
        token = text.removeprefix("/start b_").strip()
        b = conn.execute("SELECT * FROM bookings WHERE token = ?", (token,)).fetchone()
        if b is None:
            tg.send(chat_id, "Не нашёл такую заявку. Попробуйте открыть ссылку с сайта ещё раз.")
            return
        conn.execute("UPDATE bookings SET client_chat_id = ? WHERE id = ?", (chat_id, b["id"]))
        b = get_booking(conn, b["id"])
        refresh_owner_message(conn, b["id"])
        tg.send(chat_id, booking.client_message(b) + "\n\n🔔 Пришлю сюда, когда статус изменится.")
        return

    if text.startswith("/start"):
        if settings.telegram_owner_chat_id is None:
            # Помогает при настройке: так владелец узнаёт свой chat id
            tg.send(chat_id, f"Бот работает. Ваш chat id: {chat_id}\nВпишите его в TELEGRAM_OWNER_CHAT_ID на сервере.")
        elif chat_id == settings.telegram_owner_chat_id:
            tg.send(chat_id, "Бот работает. Новые заявки будут приходить сюда.")
        else:
            tg.send(chat_id, "Здравствуйте! Записаться на съёмку можно на сайте: " + settings.site_url)


def retry_undelivered(conn: sqlite3.Connection) -> None:
    """Заявки, о которых фотограф ещё не узнал (Telegram был недоступен)."""
    rows = conn.execute(
        "SELECT id FROM bookings WHERE owner_message_id IS NULL AND status = 'new' ORDER BY id LIMIT 20"
    ).fetchall()
    for r in rows:
        if not notify_owner(conn, r["id"]):
            break


class Poller(threading.Thread):
    """Получает обновления бота и повторяет недоставленные уведомления."""

    def __init__(self):
        super().__init__(name="telegram-poller", daemon=True)
        self.stop_event = threading.Event()
        self.offset = 0

    def run(self) -> None:
        log.info("Telegram: бот @%s, получаю обновления", tg.fetch_username())
        while not self.stop_event.is_set():
            conn = connect()
            try:
                retry_undelivered(conn)
                conn.commit()
                updates = tg.call("getUpdates", offset=self.offset, timeout=25,
                                  allowed_updates=["message", "callback_query"])
                if updates is None:
                    # Telegram недоступен или бот не настроен — не крутимся вхолостую
                    self.stop_event.wait(10)
                    continue
                for upd in updates:
                    self.offset = upd["update_id"] + 1
                    try:
                        handle_update(conn, upd)
                        conn.commit()
                    except Exception:
                        conn.rollback()
                        log.exception("Telegram: не удалось обработать обновление")
            except Exception:
                log.exception("Telegram: ошибка цикла")
                self.stop_event.wait(5)
            finally:
                conn.close()

    def stop(self) -> None:
        self.stop_event.set()
