from app.config import settings

from .conftest import booking_body


def test_content_seeded_from_price_list(client):
    data = client.get("/api/content").json()
    assert [p["id"] for p in data["packages"]] == ["minimal", "standard", "maximal"]
    assert [p["price"] for p in data["packages"]] == [5000, 9000, 15000]
    series = data["series"]
    assert len(series) == 1 and len(series[0]["photos"]) == 5
    photo = series[0]["photos"][0]
    assert photo["src"].startswith("/media/") and photo["srcSm"].endswith("-sm.jpg")
    assert (settings.media_dir / photo["src"].removeprefix("/media/")).exists()
    assert data["telegramBot"] == "vaag_test_bot"


def test_slots_window_and_times(client):
    data = client.get("/api/slots").json()
    assert data["times"] == ["09:00", "12:00", "15:00", "18:00"]
    assert data["first"] in data["slots"] and len(data["slots"]) == 60


def test_booking_happy_path_notifies_owner_with_buttons(client, tg, free):
    d, t = free
    r = client.post("/api/bookings", json=booking_body(d, t))
    assert r.status_code == 201, r.text
    token = r.json()["token"]

    msg = tg.sent()[-1]
    assert msg["chat_id"] == 42
    assert "Стандартный" in msg["text"] and "9 000 ₽" in msg["text"] and "Анна" in msg["text"]
    buttons = [b["callback_data"] for row in msg["reply_markup"]["inline_keyboard"] for b in row]
    assert buttons == ["c:1", "x:1"]

    assert t not in client.get("/api/slots").json()["slots"][d]
    status = client.get(f"/api/bookings/{token}").json()
    assert status["status"] == "new" and status["packageName"] == "Стандартный" and not status["subscribed"]


def test_same_slot_twice_is_rejected(client, free):
    d, t = free
    assert client.post("/api/bookings", json=booking_body(d, t)).status_code == 201
    r = client.post("/api/bookings", json=booking_body(d, t, name="Оля", contact="@olya"))
    assert r.status_code == 409


def test_validation_messages(client, free):
    d, t = free
    cases = [
        ({"packageId": "nope"}, "Выберите пакет."),
        ({"date": "2020-01-01"}, "На эту дату запись недоступна."),
        ({"time": "13:37"}, "Выберите время."),
        ({"name": "  "}, "Напишите, как к вам обращаться."),
        ({"contact": "@a"}, "Оставьте Telegram или телефон, чтобы я мог ответить."),
        ({"consent": False}, "Отметьте согласие на обработку персональных данных."),
    ]
    for override, message in cases:
        r = client.post("/api/bookings", json=booking_body(d, t, **override))
        assert r.status_code == 400 and r.json()["detail"] == message, (override, r.text)


def test_honeypot_saves_nothing(client, tg, free):
    d, t = free
    r = client.post("/api/bookings", json=booking_body(d, t, website="spam"))
    assert r.status_code == 201 and r.json()["token"] is None
    assert tg.sent() == [] and t in client.get("/api/slots").json()["slots"][d]


def test_rate_limit_three_per_hour(client):
    slots = client.get("/api/slots").json()["slots"]
    pairs = [(d, t) for d, ts in slots.items() for t in ts][:4]
    codes = [client.post("/api/bookings", json=booking_body(d, t)).status_code for d, t in pairs]
    assert codes == [201, 201, 201, 429]


def test_telegram_down_keeps_booking_and_retries(client, tg, free):
    from app import telegram
    from app.db import connect

    tg.down = True
    d, t = free
    assert client.post("/api/bookings", json=booking_body(d, t)).status_code == 201
    assert tg.sent() == []

    tg.down = False
    conn = connect()
    telegram.retry_undelivered(conn)
    conn.commit()
    assert len(tg.sent()) == 1 and "Анна" in tg.sent()[0]["text"]
    telegram.retry_undelivered(conn)  # второй раз не дублирует
    assert len(tg.sent()) == 1
    conn.close()
