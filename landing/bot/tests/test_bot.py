import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import core  # noqa: E402
import index  # noqa: E402
from bot import Bot, webhook_secret  # noqa: E402
from store import MemoryStore  # noqa: E402

OWNER = 1000
CLIENT = 2000


class FakeTelegram:
    token = "123:TEST"

    def __init__(self):
        self.sent: list[dict] = []
        self.edits: list[dict] = []
        self.calls: list[tuple] = []
        self.log: list[dict] = []
        self.next_id = 1

    def send(self, chat_id, text, buttons=None):
        self.next_id += 1
        self.sent.append({"chat": chat_id, "text": text, "buttons": buttons or [], "id": self.next_id})
        self.log.append(self.sent[-1])
        return self.next_id

    def edit(self, chat_id, message_id, text, buttons=None):
        self.edits.append({"chat": chat_id, "id": message_id, "text": text, "buttons": buttons or []})
        self.log.append(self.edits[-1])
        return True

    def answer(self, callback_id, text=None):
        self.calls.append(("answer", text))

    def call(self, method, **params):
        self.calls.append((method, params))
        return []

    def last(self, chat_id):
        """Последний текст, который увидел чат (новое сообщение или правка)."""
        items = [m for m in self.log if m["chat"] == chat_id]
        return items[-1]


YDB = os.environ.get("YDB_TEST_ENDPOINT")


def make_store(kind):
    if kind == "memory":
        return MemoryStore()
    if not YDB:
        pytest.skip("YDB_TEST_ENDPOINT не задан — тесты на настоящей YDB пропущены")
    from store import YdbStore
    store = YdbStore(YDB, os.environ.get("YDB_TEST_DATABASE", "/local"))
    for table in ("bookings", "slots", "kv"):
        store._q(f"DELETE FROM {table}")
    return store


@pytest.fixture(params=["memory", "ydb"])
def env(request):
    store = make_store(request.param)
    tg = FakeTelegram()
    bot = Bot(store, tg, username="vaag_test_bot", owner_username="vaaaaaag")
    return bot, store, tg


def message(chat_id, text, username="client"):
    return {"message": {"chat": {"id": chat_id, "type": "private"},
                        "from": {"id": chat_id, "first_name": "Аня", "username": username}, "text": text}}


def press(chat_id, data, username="client", message_id=50):
    return {"callback_query": {"id": "cb", "data": data, "from": {"id": chat_id, "first_name": "Аня", "username": username},
                               "message": {"message_id": message_id, "chat": {"id": chat_id, "type": "private"}}}}


def register_owner(bot):
    bot.handle_update(message(OWNER, "/start", username="Vaaaaaag"))


def call(bot, method, r, body=None, headers=None):
    event = {"httpMethod": method, "queryStringParameters": {"r": r}, "headers": headers or {},
             "body": json.dumps(body) if body is not None else "", "isBase64Encoded": False,
             "requestContext": {"identity": {"sourceIp": "1.2.3.4"}}}
    res = index.handler(event, None, bot=bot)
    return res["statusCode"], json.loads(res["body"]) if res["body"] else None


def first_free(bot):
    slots = bot.free_slots()["slots"]
    day = next(d for d, t in sorted(slots.items()) if t)
    return day, slots[day][0]


def site_booking(bot, **over):
    day, tm = first_free(bot)
    body = {"packageId": "standard", "date": day, "time": tm, "name": "Аня", "contact": "@anya",
            "comment": "", "consent": True, **over}
    return call(bot, "POST", "bookings", body)


def buttons_data(msg):
    return [b.get("callback_data") for row in msg["buttons"] for b in row]


# ---------- сайт ----------

def test_content_and_slots(env):
    bot, _, _ = env
    status, data = call(bot, "GET", "content")
    assert status == 200 and data["telegramBot"] == "vaag_test_bot"
    assert [p["id"] for p in data["packages"]] == ["minimal", "standard", "maximal"]
    status, data = call(bot, "GET", "slots")
    assert status == 200 and data["times"] == core.SCHEDULE["slot_times"] and data["slots"]


def test_site_booking_goes_to_owner_and_takes_slot(env):
    bot, store, tg = env
    register_owner(bot)
    status, data = site_booking(bot)
    assert status == 201 and data["token"]
    owner_msg = tg.sent[-1]
    assert owner_msg["chat"] == OWNER and "Заявка на съёмку" in owner_msg["text"]
    assert f"c:{data['token']}" in buttons_data(owner_msg)

    # то же окошко второй раз — 409
    b = store.get_booking(data["token"])
    status, again = call(bot, "POST", "bookings", {"packageId": "standard", "date": b["date"], "time": b["time"],
                                                   "name": "Б", "contact": "@bob", "consent": True})
    assert status == 409 and "заняли" in again["detail"]
    assert b["time"] not in bot.free_slots()["slots"][b["date"]]

    status, st = call(bot, "GET", f"bookings/{data['token']}")
    assert status == 200 and st["status"] == "new" and st["subscribed"] is False


def test_site_validation_and_honeypot(env):
    bot, store, _ = env
    status, data = site_booking(bot, consent=False)
    assert status == 400 and "согласие" in data["detail"]
    status, data = site_booking(bot, website="spam")
    assert status == 201 and data["token"] is None and not store.bookings_from("")
    status, _ = call(bot, "GET", "bookings/nope")
    assert status == 404


def test_rate_limit(env):
    bot, _, _ = env
    for _ in range(5):
        assert site_booking(bot)[0] == 201
    assert site_booking(bot)[0] == 429


def test_owner_registered_later_gets_pending(env):
    bot, _, tg = env
    _, data = site_booking(bot)
    assert not tg.sent
    register_owner(bot)
    assert any(m["chat"] == OWNER and f"c:{data['token']}" in buttons_data(m) for m in tg.sent)


def test_owner_confirms_client_subscribed_from_site(env):
    bot, store, tg = env
    register_owner(bot)
    _, data = site_booking(bot)
    token = data["token"]
    bot.handle_update(message(CLIENT, f"/start b_{token}"))
    assert "Пришлю сюда" in tg.sent[-1]["text"]
    assert call(bot, "GET", f"bookings/{token}")[1]["subscribed"] is True

    # чужой не может нажать кнопку фотографа
    bot.handle_update(press(CLIENT, f"c:{token}"))
    assert store.get_booking(token)["status"] == "new"

    bot.handle_update(press(OWNER, f"c:{token}", username="vaaaaaag"))
    assert store.get_booking(token)["status"] == "confirmed"
    assert "подтверждена" in tg.last(CLIENT)["text"]
    assert "подтверждена" in [e for e in tg.edits if e["chat"] == OWNER][-1]["text"]

    bot.handle_update(press(OWNER, f"x:{token}", username="vaaaaaag"))
    b = store.get_booking(token)
    assert b["status"] == "cancelled" and b["time"] in bot.free_slots()["slots"][b["date"]]
    assert "отменена" in tg.last(CLIENT)["text"]


# ---------- запись в боте ----------

def test_booking_in_bot(env):
    bot, store, tg = env
    register_owner(bot)
    bot.handle_update(message(CLIENT, "/start"))
    assert "bk" in buttons_data(tg.last(CLIENT))

    bot.handle_update(press(CLIENT, "bk"))
    assert "p:maximal" in buttons_data(tg.last(CLIENT))
    bot.handle_update(press(CLIENT, "p:maximal"))
    day_btn = next(d for d in buttons_data(tg.last(CLIENT)) if d.startswith("d:"))
    bot.handle_update(press(CLIENT, day_btn))
    time_btn = next(d for d in buttons_data(tg.last(CLIENT)) if d.startswith("t:"))
    bot.handle_update(press(CLIENT, time_btn))
    assert "Как к вам обращаться" in tg.last(CLIENT)["text"]

    bot.handle_update(message(CLIENT, "Анна"))
    assert "пожелания" in tg.last(CLIENT)["text"]
    bot.handle_update(message(CLIENT, "Хочу в лес <на закате>"))
    confirm = tg.last(CLIENT)
    assert "Проверьте заявку" in confirm["text"] and "&lt;на закате&gt;" in confirm["text"]
    assert "#privacy" in confirm["text"]

    bot.handle_update(press(CLIENT, "ok"))
    assert "Заявка получена" in tg.last(CLIENT)["text"]
    (b,) = store.bookings_from("")
    assert (b["package_id"], b["name"], b["contact"], b["source"], b["client_chat"]) == \
        ("maximal", "Анна", "@client", "bot", CLIENT)
    assert b["date"] == day_btn.split(":")[2] and b["time"] == time_btn.split(":", 3)[3]
    owner_msg = [m for m in tg.sent if m["chat"] == OWNER][-1]
    assert "через бота" in owner_msg["text"] and f'tg://user?id={CLIENT}' in owner_msg["text"]

    # повторное «Записаться» не создаёт вторую заявку
    bot.handle_update(press(CLIENT, "ok"))
    assert len(store.bookings_from("")) == 1

    # фотограф подтверждает — клиенту приходит ответ
    bot.handle_update(press(OWNER, f"c:{b['token']}", username="vaaaaaag"))
    assert "Съёмка подтверждена" in tg.last(CLIENT)["text"]

    # клиент сам отменяет — фотографу приходит сообщение, окошко освобождается
    bot.handle_update(press(CLIENT, "my"))
    assert f"cx:{b['token']}" in buttons_data(tg.last(CLIENT))
    bot.handle_update(press(CLIENT, f"cx:{b['token']}"))
    bot.handle_update(press(CLIENT, f"cy:{b['token']}"))
    assert store.get_booking(b["token"])["status"] == "cancelled"
    assert "Клиент отменил" in [m for m in tg.sent if m["chat"] == OWNER][-1]["text"]


def test_start_book_from_site_link(env):
    bot, _, tg = env
    bot.handle_update(message(CLIENT, "/start book"))
    assert "Выберите пакет" in tg.last(CLIENT)["text"]


def test_bot_name_button_and_no_comment(env):
    bot, store, tg = env
    day, tm = first_free(bot)
    bot.handle_update(press(CLIENT, f"t:minimal:{day}:{tm}"))
    bot.handle_update(press(CLIENT, "n"))
    bot.handle_update(press(CLIENT, "nc"))
    bot.handle_update(press(CLIENT, "ok"))
    (b,) = store.bookings_from("")
    assert b["name"] == "Аня" and b["comment"] == "" and b["package_id"] == "minimal"


def test_taken_time_in_bot(env):
    bot, _, tg = env
    day, tm = first_free(bot)
    site_booking(bot)
    bot.handle_update(press(CLIENT, f"t:standard:{day}:{tm}"))
    assert ("answer", "Это время уже заняли") in tg.calls


def test_price_portfolio_contacts(env):
    bot, _, tg = env
    bot.handle_update(message(CLIENT, "/price"))
    assert "15 000 ₽" in tg.last(CLIENT)["text"]
    bot.handle_update(message(CLIENT, "/portfolio"))
    method, params = next(c for c in tg.calls if c[0] == "sendMediaGroup")
    assert params["media"][0]["media"].endswith("/portfolio/forest-road.jpg")
    bot.handle_update(message(CLIENT, "/contacts"))
    assert "@vaaaaaag" in tg.last(CLIENT)["text"]


# ---------- команды фотографа ----------

def test_owner_close_day(env):
    bot, _, tg = env
    register_owner(bot)
    day, _ = first_free(bot)
    d = day.split("-")
    bot.handle_update(message(OWNER, f"/close {int(d[2])}.{int(d[1])}", username="vaaaaaag"))
    assert "закрыт" in tg.last(OWNER)["text"]
    assert day not in bot.free_slots()["slots"]
    assert site_booking(bot, date=day)[0] == 400
    bot.handle_update(message(OWNER, "/closed", username="vaaaaaag"))
    assert core.format_date_ru(day) in tg.last(OWNER)["text"]
    bot.handle_update(message(OWNER, f"/open {day}", username="vaaaaaag"))
    assert day in bot.free_slots()["slots"]

    # клиенту команды фотографа недоступны
    bot.handle_update(message(CLIENT, f"/close {day}"))
    assert day in bot.free_slots()["slots"]


def test_owner_bookings_list(env):
    bot, _, tg = env
    register_owner(bot)
    site_booking(bot)
    bot.handle_update(message(OWNER, "/bookings", username="vaaaaaag"))
    assert "Ближайшие записи" in tg.last(OWNER)["text"] and "@anya" in tg.last(OWNER)["text"]


# ---------- вебхук ----------

def test_webhook_secret(env):
    bot, _, tg = env
    upd = message(CLIENT, "/start")
    assert call(bot, "POST", "tg", upd)[0] == 403
    status, _ = call(bot, "POST", "tg", upd, {"X-Telegram-Bot-Api-Secret-Token": webhook_secret(tg.token)})
    assert status == 200 and tg.sent


def test_cors_preflight():
    res = index.handler({"httpMethod": "OPTIONS"}, None)
    assert res["statusCode"] == 204 and res["headers"]["Access-Control-Allow-Origin"] == "*"


def test_parse_day():
    from datetime import datetime
    now = datetime(2026, 10, 26, 12, tzinfo=core.TZ)
    assert core.parse_day("7.11", now) == "2026-11-07"
    assert core.parse_day("1.02", now) == "2027-02-01"
    assert core.parse_day("2026-12-31", now) == "2026-12-31"
    assert core.parse_day("31.02", now) is None
