"""Заявки и бот Telegram.

Клиент записывается на сайте или прямо в боте (пакет → дата → время → имя → пожелания → согласие).
Фотограф получает заявку с кнопками «Подтвердить» и «Отменить», клиенту приходит ответ.
Фотограф узнаётся по username (OWNER_USERNAME): его chat id запоминается при первом сообщении боту.
"""
import hashlib
import os
import secrets
from html import escape

import core
from store import SlotTaken, Store, now_ts
from tg import Telegram

MAX_BOOKINGS_PER_HOUR = 5
DAYS_PER_PAGE = 8


class BookingError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def webhook_secret(token: str) -> str:
    """Секрет вебхука: Telegram присылает его в заголовке, так чужие запросы не пройдут."""
    return hashlib.sha256(f"vaag-webhook:{token}".encode()).hexdigest()[:48]


def btn(text: str, data: str) -> dict:
    return {"text": text, "callback_data": data}


def url_btn(text: str, url: str) -> dict:
    return {"text": text, "url": url}


MENU = [
    [btn("📅 Записаться", "bk")],
    [btn("💰 Прайс", "price"), btn("📷 Портфолио", "pf")],
    [btn("🗓 Мои записи", "my"), btn("✉️ Контакты", "ct")],
]
BACK_TO_MENU = [[btn("← В меню", "m")]]


class Bot:
    def __init__(self, store: Store, tg: Telegram, username: str | None = None, owner_username: str | None = None):
        self.store = store
        self.tg = tg
        self.username = username if username is not None else os.environ.get("BOT_USERNAME") or None
        owner = owner_username if owner_username is not None else os.environ.get("OWNER_USERNAME", core.OWNER_TELEGRAM)
        self.owner_username = owner.lstrip("@").lower()

    # ================= Заявки (общие для сайта и бота) =================

    def free_slots(self) -> dict:
        first, _ = core.booking_window()
        return core.free_slots(self.store.taken(first.isoformat()), self.store.closed_days())

    def _rate_limit(self, key: str) -> None:
        now = now_ts()
        recent = [t for t in self.store.get_json(key, []) if t > now - 3600]
        if len(recent) >= MAX_BOOKINGS_PER_HOUR:
            raise BookingError(429, "Слишком много заявок подряд. Напишите мне в Telegram.")
        self.store.put_json(key, recent + [now])

    def create_booking(self, data: dict, source: str, client_chat: int | None = None,
                       ip: str | None = None) -> dict:
        if problem := core.validate(data, self.store.closed_days()):
            raise BookingError(400, problem)
        ip_hash = hashlib.sha256(ip.encode()).hexdigest() if ip else None
        self._rate_limit(f"rl:{ip_hash}" if ip_hash else f"rl:chat{client_chat}")
        pkg = core.package(data["packageId"])
        b = {
            "token": secrets.token_urlsafe(12), "created": now_ts(), "package_id": pkg["id"],
            "package_name": pkg["name"], "package_price": pkg["price"], "date": data["date"], "time": data["time"],
            "name": str(data["name"]).strip(), "contact": str(data["contact"]).strip(),
            "comment": str(data.get("comment") or "").strip(), "status": "new", "source": source,
            "client_chat": client_chat, "owner_msg": None, "ip_hash": ip_hash,
        }
        try:
            self.store.create_booking(b)
        except SlotTaken:
            raise BookingError(409, "Это время только что заняли. Выберите другое.") from None
        self.notify_owner(b)
        return b

    def owner_buttons(self, b: dict) -> list:
        rows = []
        if b["status"] == "new":
            rows.append([btn("✅ Подтвердить", f"c:{b['token']}"), btn("✖️ Отменить", f"x:{b['token']}")])
        elif b["status"] == "confirmed":
            rows.append([btn("✖️ Отменить", f"x:{b['token']}")])
        contact = b["contact"]
        if contact.startswith("@") and len(contact) > 1:
            rows.append([url_btn("💬 Написать клиенту", f"https://t.me/{contact[1:]}")])
        return rows

    def notify_owner(self, b: dict) -> bool:
        """Сообщение фотографу. False — пока некуда (фотограф ещё не писал боту) или Telegram недоступен."""
        owner = self.store.owner_chat()
        if owner is None:
            return False
        msg_id = self.tg.send(owner, core.owner_message(b), self.owner_buttons(b))
        if msg_id is None:
            return False
        self.store.update_booking(b["token"], owner_msg=msg_id)
        b["owner_msg"] = msg_id
        return True

    def notify_pending(self) -> None:
        """Заявки, о которых фотограф ещё не знает."""
        for b in self.store.bookings_from(core.today().isoformat()):
            if b["status"] == "new" and not b["owner_msg"] and not self.notify_owner(b):
                break

    def refresh_owner_message(self, b: dict) -> None:
        owner = self.store.owner_chat()
        if owner is not None and b.get("owner_msg"):
            self.tg.edit(owner, b["owner_msg"], core.owner_message(b), self.owner_buttons(b))

    def set_status(self, token: str, status: str, by_client: bool = False) -> dict | None:
        b = self.store.get_booking(token)
        if b is None:
            return None
        if b["status"] == status:
            return b
        if b["status"] == "cancelled":
            raise BookingError(409, "Заявка уже отменена.")
        if status == "cancelled":
            self.store.cancel_booking(token)
        else:
            self.store.update_booking(token, status=status)
        b["status"] = status
        self.refresh_owner_message(b)
        if by_client:
            owner = self.store.owner_chat()
            if owner is not None:
                self.tg.send(owner, f"Клиент отменил запись: {escape(b['name'])}, "
                                    f"{core.format_date_ru(b['date'], False)}, {b['time']}. Окошко снова свободно.")
        elif b.get("client_chat"):
            self.tg.send(b["client_chat"], core.client_message(b), self.client_buttons(b))
        return b

    def client_buttons(self, b: dict) -> list:
        if b["status"] == "cancelled":
            return [[btn("📅 Записаться снова", "bk")]]
        return [[btn("Отменить запись", f"cx:{b['token']}")], [btn("← В меню", "m")]]

    def status_for_site(self, token: str) -> dict | None:
        b = self.store.get_booking(token)
        if b is None:
            return None
        return {
            "status": b["status"], "packageName": b["package_name"], "packagePrice": b["package_price"],
            "date": b["date"], "time": b["time"], "name": b["name"], "subscribed": b["client_chat"] is not None,
            "telegramBot": self.username,
        }

    # ================= Telegram =================

    def handle_update(self, upd: dict) -> None:
        if cq := upd.get("callback_query"):
            self.on_callback(cq)
        elif msg := upd.get("message"):
            self.on_message(msg)

    def is_owner(self, chat_id: int) -> bool:
        return chat_id == self.store.owner_chat()

    def _remember_owner(self, msg: dict) -> None:
        user = msg.get("from") or {}
        chat = msg.get("chat") or {}
        if (chat.get("type") == "private" and (user.get("username") or "").lower() == self.owner_username
                and self.store.owner_chat() != chat["id"]):
            self.store.put("owner", str(chat["id"]))
            self.tg.send(chat["id"], "Готово: вы — фотограф. Новые заявки будут приходить сюда.\n\n" + OWNER_HELP)
            self.notify_pending()

    # ---------- состояние диалога ----------

    def state(self, chat_id: int) -> dict:
        return self.store.get_json(f"chat:{chat_id}", {})

    def set_state(self, chat_id: int, st: dict | None) -> None:
        self.store.put_json(f"chat:{chat_id}", st or None)

    # ---------- сообщения ----------

    def on_message(self, msg: dict) -> None:
        chat_id = (msg.get("chat") or {}).get("id")
        if chat_id is None or (msg.get("chat") or {}).get("type") != "private":
            return
        self._remember_owner(msg)
        text = (msg.get("text") or "").strip()
        cmd, _, arg = text.partition(" ")
        cmd = cmd.split("@")[0].lower()

        if cmd == "/start" and arg.startswith("b_"):
            return self.subscribe(chat_id, arg[2:].strip())
        if cmd == "/book" or (cmd == "/start" and arg == "book"):
            return self.ask_package(chat_id)
        if cmd in ("/start", "/menu"):
            self.set_state(chat_id, None)
            return self.menu(chat_id, greeting=True)
        if cmd == "/price":
            return self.send_price(chat_id)
        if cmd == "/portfolio":
            return self.send_portfolio(chat_id)
        if cmd == "/contacts":
            return self.tg.send(chat_id, core.contacts_message(), BACK_TO_MENU)
        if cmd == "/my":
            return self.my_bookings(chat_id)
        if cmd == "/cancel":
            self.set_state(chat_id, None)
            return self.menu(chat_id)
        if self.is_owner(chat_id) and cmd in OWNER_COMMANDS:
            return OWNER_COMMANDS[cmd](self, chat_id, arg.strip())

        st = self.state(chat_id)
        if st.get("step") == "name" and text and not text.startswith("/"):
            if len(text) > core.LIMITS["name"]:
                return self.tg.send(chat_id, "Имя слишком длинное — напишите покороче.")
            st["name"] = text
            return self.ask_comment(chat_id, st)
        if st.get("step") == "comment" and text and not text.startswith("/"):
            if len(text) > core.LIMITS["comment"]:
                return self.tg.send(chat_id, f"Комментарий длиннее {core.LIMITS['comment']} символов — сократите, пожалуйста.")
            st["comment"] = text
            return self.ask_confirm(chat_id, st)

        self.tg.send(chat_id, f"Я бот для записи на съёмку. Написать мне лично: @{core.OWNER_TELEGRAM}", MENU)

    def menu(self, chat_id: int, greeting: bool = False, edit: int | None = None) -> None:
        text = ("Привет! Я Вааг, портретный фотограф в Санкт-Петербурге.\n\n"
                "Здесь можно записаться на съёмку, посмотреть прайс и портфолио." if greeting else "Что дальше?")
        if self.is_owner(chat_id) and greeting:
            text += "\n\n" + OWNER_HELP
        self._show(chat_id, text, MENU, edit)

    def _show(self, chat_id: int, text: str, buttons: list, edit: int | None = None) -> None:
        """Обновить сообщение с кнопками на месте, а если не вышло — прислать новое."""
        if edit is None or not self.tg.edit(chat_id, edit, text, buttons):
            self.tg.send(chat_id, text, buttons)

    def send_price(self, chat_id: int) -> None:
        self.tg.send(chat_id, core.price_message(), [[btn("📅 Записаться", "bk")], [btn("← В меню", "m")]])

    def send_portfolio(self, chat_id: int) -> None:
        photos = core.portfolio_photos()
        if photos:
            media = [{"type": "photo", "media": p["url"]} for p in photos]
            media[0]["caption"] = "Серия «" + core.SERIES[0]["title"] + "»"
            self.tg.call("sendMediaGroup", chat_id=chat_id, media=media)
        self.tg.send(chat_id, "📷 Всё портфолио — на сайте.",
                     [[url_btn("Открыть портфолио", f"{core.SITE_URL}/#portfolio")], [btn("📅 Записаться", "bk")]])

    def subscribe(self, chat_id: int, token: str) -> None:
        b = self.store.get_booking(token)
        if b is None:
            return self.tg.send(chat_id, "Не нашёл такую заявку. Попробуйте открыть ссылку с сайта ещё раз.", MENU)
        self.store.update_booking(token, client_chat=chat_id)
        b["client_chat"] = chat_id
        self.refresh_owner_message(b)
        self.tg.send(chat_id, core.client_message(b) + "\n\n🔔 Пришлю сюда, когда статус изменится.",
                     self.client_buttons(b))

    def my_bookings(self, chat_id: int, edit: int | None = None) -> None:
        mine = [b for b in self.store.bookings_from(core.today().isoformat())
                if b["client_chat"] == chat_id and b["status"] != "cancelled"]
        if not mine:
            return self._show(chat_id, "У вас пока нет записей.", [[btn("📅 Записаться", "bk")], [btn("← В меню", "m")]], edit)
        lines = ["🗓 <b>Ваши записи</b>", ""]
        rows = []
        for b in mine:
            lines.append(f"{core.format_date_ru(b['date'], False)}, {b['time']} — {escape(b['package_name'])}, "
                         f"{core.STATUS_RU[b['status']]}")
            rows.append([btn(f"Отменить {core.format_date_short(b['date'])}, {b['time']}", f"cx:{b['token']}")])
        self._show(chat_id, "\n".join(lines), rows + [[btn("← В меню", "m")]], edit)

    # ---------- запись в боте ----------

    def ask_package(self, chat_id: int, edit: int | None = None) -> None:
        rows = [[btn(f"{p['name']} · {core.package_summary(p)} · {core.format_price(p['price'])}", f"p:{p['id']}")]
                for p in core.PACKAGES]
        self._show(chat_id, "📅 <b>Запись на съёмку</b>\n\nВыберите пакет:", rows + BACK_TO_MENU, edit)

    def ask_date(self, chat_id: int, pkg_id: str, page: int = 0, edit: int | None = None) -> None:
        pkg = core.package(pkg_id)
        if pkg is None:
            return self.ask_package(chat_id, edit)
        days = [d for d, times in sorted(self.free_slots()["slots"].items()) if times]
        if not days:
            return self._show(chat_id, f"Свободных окошек сейчас нет. Напишите мне: @{core.OWNER_TELEGRAM}", BACK_TO_MENU, edit)
        page = max(0, min(page, (len(days) - 1) // DAYS_PER_PAGE))
        chunk = days[page * DAYS_PER_PAGE:(page + 1) * DAYS_PER_PAGE]
        rows = [[btn(core.format_date_short(d), f"d:{pkg_id}:{d}") for d in chunk[i:i + 2]]
                for i in range(0, len(chunk), 2)]
        nav = []
        if page > 0:
            nav.append(btn("← Раньше", f"p:{pkg_id}:{page - 1}"))
        if (page + 1) * DAYS_PER_PAGE < len(days):
            nav.append(btn("Позже →", f"p:{pkg_id}:{page + 1}"))
        if nav:
            rows.append(nav)
        rows.append([btn("← Пакеты", "bk")])
        self._show(chat_id, f"<b>{escape(pkg['name'])}</b> · {core.format_price(pkg['price'])}\n\nВыберите день:", rows, edit)

    def ask_time(self, chat_id: int, pkg_id: str, day: str, edit: int | None = None) -> None:
        times = self.free_slots()["slots"].get(day) or []
        if not times:
            self._show(chat_id, "Этот день уже заняли — выберите другой.", [[btn("← К датам", f"p:{pkg_id}")]], edit)
            return
        rows = [[btn(t, f"t:{pkg_id}:{day}:{t}") for t in times[i:i + 4]] for i in range(0, len(times), 4)]
        rows.append([btn("← К датам", f"p:{pkg_id}")])
        self._show(chat_id, f"{core.format_date_ru(day, False).capitalize()}\n\nВыберите время:", rows, edit)

    def ask_name(self, chat_id: int, st: dict, user: dict, edit: int | None = None) -> None:
        st["step"] = "name"
        self.set_state(chat_id, st)
        rows = []
        tg_name = " ".join(x for x in (user.get("first_name"), user.get("last_name")) if x).strip()
        if tg_name:
            rows.append([btn(tg_name[: core.LIMITS["name"]], "n")])
        rows.append([btn("← К времени", f"d:{st['pkg']}:{st['date']}")])
        self._show(chat_id, "Как к вам обращаться? Напишите имя или нажмите кнопку.", rows, edit)

    def ask_comment(self, chat_id: int, st: dict, edit: int | None = None) -> None:
        st["step"] = "comment"
        self.set_state(chat_id, st)
        self._show(chat_id, "Есть пожелания к съёмке — место, образ, идея? Напишите одним сообщением "
                            "или нажмите «Без комментария».", [[btn("Без комментария", "nc")]], edit)

    def ask_confirm(self, chat_id: int, st: dict, edit: int | None = None) -> None:
        st["step"] = "confirm"
        self.set_state(chat_id, st)
        pkg = core.package(st["pkg"])
        lines = [
            "<b>Проверьте заявку</b>", "",
            f"Пакет: {escape(pkg['name'])} — {core.format_price(pkg['price'])}",
            f"Дата: {core.format_date_ru(st['date'], False)}",
            f"Время: {st['time']}",
            f"Имя: {escape(st['name'])}",
        ]
        if st.get("comment"):
            lines.append(f"Комментарий: {escape(st['comment'])}")
        lines += ["", f'Нажимая «Записаться», вы соглашаетесь на <a href="{core.SITE_URL}/#privacy">обработку '
                      "персональных данных</a>: имя, контакт в Telegram и детали съёмки придут мне."]
        rows = [[btn("✅ Записаться", "ok")], [btn("Изменить время", f"p:{st['pkg']}"), btn("Отмена", "m")]]
        self._show(chat_id, "\n".join(lines), rows, edit)

    def finish_booking(self, chat_id: int, user: dict, edit: int | None) -> None:
        st = self.state(chat_id)
        if st.get("step") != "confirm":
            return self.ask_package(chat_id, edit)
        username = user.get("username")
        data = {"packageId": st["pkg"], "date": st["date"], "time": st["time"], "name": st["name"],
                "contact": f"@{username}" if username else f"Telegram, id {chat_id}",
                "comment": st.get("comment", ""), "consent": True}
        try:
            b = self.create_booking(data, "bot", client_chat=chat_id)
        except BookingError as err:
            if err.status == 409:
                return self._show(chat_id, err.message, [[btn("Выбрать другое время", f"p:{st['pkg']}")]], edit)
            return self._show(chat_id, err.message, BACK_TO_MENU, edit)
        self.set_state(chat_id, None)
        self._show(chat_id, core.client_message(b), self.client_buttons(b), edit)

    # ---------- кнопки ----------

    def on_callback(self, cq: dict) -> None:
        msg = cq.get("message") or {}
        chat_id = (msg.get("chat") or {}).get("id")
        msg_id = msg.get("message_id")
        user = cq.get("from") or {}
        data = cq.get("data") or ""
        action, _, rest = data.partition(":")
        notice = None
        if chat_id is None:
            return self.tg.answer(cq["id"])

        if action in ("c", "x"):
            notice = self.owner_action(chat_id, action, rest)
        elif action == "m":
            self.set_state(chat_id, None)
            self.menu(chat_id, edit=msg_id)
        elif action == "bk":
            self.ask_package(chat_id, msg_id)
        elif action == "price":
            self.send_price(chat_id)
        elif action == "pf":
            self.send_portfolio(chat_id)
        elif action == "ct":
            self.tg.send(chat_id, core.contacts_message(), BACK_TO_MENU)
        elif action == "my":
            self.my_bookings(chat_id, msg_id)
        elif action == "p":
            pkg_id, _, page = rest.partition(":")
            self.ask_date(chat_id, pkg_id, int(page) if page.isdigit() else 0, msg_id)
        elif action == "d":
            pkg_id, _, day = rest.partition(":")
            self.ask_time(chat_id, pkg_id, day, msg_id)
        elif action == "t":
            pkg_id, day, tm = rest.split(":", 2) if rest.count(":") >= 2 else ("", "", "")
            if tm not in (self.free_slots()["slots"].get(day) or []):
                notice = "Это время уже заняли"
                self.ask_time(chat_id, pkg_id, day, msg_id)
            else:
                self.ask_name(chat_id, {"pkg": pkg_id, "date": day, "time": tm}, user, msg_id)
        elif action == "n":
            st = self.state(chat_id)
            if st.get("step") == "name":
                st["name"] = " ".join(x for x in (user.get("first_name"), user.get("last_name")) if x)[: core.LIMITS["name"]]
                self.ask_comment(chat_id, st, msg_id)
        elif action == "nc":
            st = self.state(chat_id)
            if st.get("step") == "comment":
                st["comment"] = ""
                self.ask_confirm(chat_id, st, msg_id)
        elif action == "ok":
            self.finish_booking(chat_id, user, msg_id)
        elif action == "cx":
            b = self.store.get_booking(rest)
            if b and b["client_chat"] == chat_id and b["status"] != "cancelled":
                self._show(chat_id, f"Отменить запись на {core.format_date_ru(b['date'], False)}, {b['time']}?",
                           [[btn("Да, отменить", f"cy:{rest}"), btn("Нет", "my")]], msg_id)
        elif action == "cy":
            b = self.store.get_booking(rest)
            if b and b["client_chat"] == chat_id and b["status"] != "cancelled":
                b = self.set_status(rest, "cancelled", by_client=True)
                self._show(chat_id, core.client_message(b), self.client_buttons(b), msg_id)
                notice = "Запись отменена"
        self.tg.answer(cq["id"], notice)

    def owner_action(self, chat_id: int, action: str, token: str) -> str:
        if not self.is_owner(chat_id):
            return "Эти кнопки только для фотографа."
        status = "confirmed" if action == "c" else "cancelled"
        try:
            b = self.set_status(token, status)
        except BookingError as err:
            return err.message
        if b is None:
            return "Заявка не найдена"
        return f"Заявка {core.STATUS_RU[status]}" + (", клиенту отправлен ответ" if b.get("client_chat") else "")


# ================= Команды фотографа =================

OWNER_HELP = (
    "Команды фотографа:\n"
    "/bookings — ближайшие записи\n"
    "/close 7.11 — закрыть день для записи\n"
    "/open 7.11 — открыть день снова\n"
    "/closed — закрытые дни"
)


def cmd_bookings(bot: Bot, chat_id: int, _arg: str) -> None:
    items = [b for b in bot.store.bookings_from(core.today().isoformat()) if b["status"] != "cancelled"]
    if not items:
        return bot.tg.send(chat_id, "Ближайших записей нет.")
    lines = ["🗓 <b>Ближайшие записи</b>", ""]
    for b in items[:30]:
        mark = "✅" if b["status"] == "confirmed" else "🆕"
        lines.append(f"{mark} {core.format_date_short(b['date'])}, {b['time']} — {escape(b['name'])}, "
                     f"{escape(b['package_name'])}, {escape(b['contact'])}")
    if len(items) > 30:
        lines.append(f"…и ещё {len(items) - 30}")
    bot.tg.send(chat_id, "\n".join(lines))
    bot.notify_pending()


def cmd_close(bot: Bot, chat_id: int, arg: str, open_: bool = False) -> None:
    day = core.parse_day(arg)
    if day is None:
        return bot.tg.send(chat_id, f"Напишите дату, например: /{'open' if open_ else 'close'} 7.11")
    days = bot.store.closed_days()
    if open_:
        days.discard(day)
    else:
        days.add(day)
    bot.store.set_closed_days({d for d in days if d >= core.today().isoformat()})
    when = core.format_date_ru(day)
    if open_:
        return bot.tg.send(chat_id, f"День открыт для записи: {when}")
    busy = [b for b in bot.store.bookings_from(day) if b["date"] == day and b["status"] != "cancelled"]
    note = f"\n\nНа этот день уже есть записи ({len(busy)}) — они остались. Посмотреть: /bookings" if busy else ""
    bot.tg.send(chat_id, f"День закрыт для записи: {when}{note}")


def cmd_closed(bot: Bot, chat_id: int, _arg: str) -> None:
    days = sorted(d for d in bot.store.closed_days() if d >= core.today().isoformat())
    if not days:
        return bot.tg.send(chat_id, "Закрытых дней нет. Закрыть: /close 7.11")
    bot.tg.send(chat_id, "Закрыты для записи:\n" + "\n".join(core.format_date_ru(d) for d in days))


OWNER_COMMANDS = {
    "/bookings": cmd_bookings,
    "/close": cmd_close,
    "/open": lambda bot, chat_id, arg: cmd_close(bot, chat_id, arg, open_=True),
    "/closed": cmd_closed,
}
