from app import telegram
from app.db import connect

from .conftest import booking_body


def _book(client, free):
    d, t = free
    r = client.post("/api/bookings", json=booking_body(d, t))
    return r.json()["token"], d, t


def _update(upd: dict):
    conn = connect()
    telegram.handle_update(conn, upd)
    conn.commit()
    conn.close()


def _press(data: str, chat_id: int = 42):
    _update({"update_id": 1, "callback_query": {"id": "cb1", "data": data, "message": {"chat": {"id": chat_id}}}})


def test_owner_confirms_from_telegram_and_client_is_told(client, tg, free):
    token, d, t = _book(client, free)
    # клиент подписывается на бота по ссылке с сайта
    _update({"update_id": 1, "message": {"chat": {"id": 777}, "text": f"/start b_{token}"}})
    assert tg.sent()[-1]["chat_id"] == 777 and "Заявка получена" in tg.sent()[-1]["text"]
    assert client.get(f"/api/bookings/{token}").json()["subscribed"] is True

    _press("c:1")
    assert client.get(f"/api/bookings/{token}").json()["status"] == "confirmed"
    assert tg.sent()[-1]["chat_id"] == 777 and "подтверждена" in tg.sent()[-1]["text"]
    edited = tg.sent("editMessageText")[-1]
    assert "подтверждена" in edited["text"]
    assert [b["callback_data"] for row in edited["reply_markup"]["inline_keyboard"] for b in row] == ["x:1"]
    assert tg.sent("answerCallbackQuery")[-1]["text"] == "Заявка #1: подтверждена"


def test_cancel_frees_the_slot(client, tg, free):
    token, d, t = _book(client, free)
    _press("x:1")
    assert client.get(f"/api/bookings/{token}").json()["status"] == "cancelled"
    assert t in client.get("/api/slots").json()["slots"][d]
    # отменённую нельзя вернуть
    _press("c:1")
    assert "нельзя вернуть" in tg.sent("answerCallbackQuery")[-1]["text"]


def test_buttons_ignored_from_strangers(client, tg, free):
    token, *_ = _book(client, free)
    _press("x:1", chat_id=999)
    assert client.get(f"/api/bookings/{token}").json()["status"] == "new"
    assert tg.sent("answerCallbackQuery")[-1]["text"] == "Эти кнопки только для фотографа."


def test_start_without_token(client, tg):
    _update({"update_id": 1, "message": {"chat": {"id": 42}, "text": "/start"}})
    assert "Новые заявки будут приходить сюда" in tg.sent()[-1]["text"]
    _update({"update_id": 2, "message": {"chat": {"id": 5}, "text": "/start b_wrong"}})
    assert "Не нашёл такую заявку" in tg.sent()[-1]["text"]
