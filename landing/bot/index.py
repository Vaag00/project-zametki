"""Точка входа функции в Яндекс Облаке (Cloud Functions): index.handler.

Один адрес функции обслуживает и сайт, и Telegram. Маршрут — в параметре r:
  ?r=content            GET  пакеты и имя бота
  ?r=slots              GET  свободные окошки
  ?r=bookings           POST новая заявка с сайта
  ?r=bookings/<token>   GET  статус заявки
  ?r=tg                 POST обновления от Telegram (вебхук)
Ответы — как у сервера на своём VPS (server/), так сайт работает с обоими.
"""
import base64
import json
import logging

import core
from bot import Bot, BookingError, webhook_secret
from store import get_store
from tg import Telegram

logging.getLogger().setLevel(logging.INFO)
log = logging.getLogger("vaag")

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
}

_bot: Bot | None = None


def get_bot() -> Bot:
    global _bot
    if _bot is None:
        _bot = Bot(get_store(), Telegram())
    return _bot


def respond(status: int, data=None) -> dict:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json; charset=utf-8", **CORS},
        "body": json.dumps(data if data is not None else {}, ensure_ascii=False),
        "isBase64Encoded": False,
    }


def error(status: int, detail: str) -> dict:
    return respond(status, {"detail": detail})


def read_body(event: dict):
    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8", "replace")
    try:
        return json.loads(raw) if raw else {}
    except ValueError:
        return None


def header(event: dict, name: str) -> str | None:
    name = name.lower()
    return next((v for k, v in (event.get("headers") or {}).items() if k.lower() == name), None)


def route(event: dict) -> str:
    params = event.get("queryStringParameters") or {}
    r = params.get("r") or event.get("path") or ""
    return r.strip("/").removeprefix("api/")


def handler(event: dict, context=None, bot: Bot | None = None) -> dict:
    method = (event.get("httpMethod") or "GET").upper()
    if method == "OPTIONS":
        return {"statusCode": 204, "headers": CORS, "body": ""}
    r = route(event)
    try:
        bot = bot or get_bot()
        if r == "tg" and method == "POST":
            return telegram_webhook(event, bot)
        if r == "content" and method == "GET":
            return respond(200, {"packages": core.PACKAGES, "telegramBot": bot.username})
        if r == "slots" and method == "GET":
            return respond(200, bot.free_slots())
        if r == "bookings" and method == "POST":
            return new_booking(event, bot)
        if r.startswith("bookings/") and method == "GET":
            data = bot.status_for_site(r.removeprefix("bookings/"))
            return respond(200, data) if data else error(404, "Заявка не найдена.")
        return error(404, "Не найдено.")
    except Exception:
        log.exception("Ошибка при обработке %s %s", method, r)
        return error(500, "Ошибка сервера. Напишите мне в Telegram.")


def new_booking(event: dict, bot: Bot) -> dict:
    body = read_body(event)
    if not isinstance(body, dict):
        return error(400, "Пустая заявка.")
    if body.get("website"):
        # Ловушка для ботов: делаем вид, что всё хорошо, но ничего не сохраняем
        return respond(201, {"ok": True, "token": None})
    ip = ((event.get("requestContext") or {}).get("identity") or {}).get("sourceIp") or "unknown"
    try:
        b = bot.create_booking(body, "site", ip=ip)
    except BookingError as err:
        return error(err.status, err.message)
    return respond(201, {"ok": True, "token": b["token"]})


def telegram_webhook(event: dict, bot: Bot) -> dict:
    if header(event, "X-Telegram-Bot-Api-Secret-Token") != webhook_secret(bot.tg.token):
        return error(403, "Нет доступа.")
    upd = read_body(event)
    if isinstance(upd, dict):
        try:
            bot.handle_update(upd)
        except Exception:
            # Отвечаем 200 в любом случае: иначе Telegram будет присылать то же обновление снова и снова
            log.exception("Не удалось обработать обновление Telegram")
    return respond(200, {"ok": True})
