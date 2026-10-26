"""Подключает бота к функции: вебхук, меню команд, описание. Запускается при развёртывании.

Переменные окружения: TELEGRAM_BOT_TOKEN, FUNCTION_URL.
"""
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from bot import webhook_secret  # noqa: E402

TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
URL = os.environ["FUNCTION_URL"]
API = os.environ.get("TELEGRAM_API", "https://api.telegram.org")

COMMANDS = [
    ("book", "Записаться на съёмку"),
    ("price", "Прайс"),
    ("portfolio", "Портфолио"),
    ("my", "Мои записи"),
    ("contacts", "Контакты"),
]


def call(method: str, **params):
    req = urllib.request.Request(f"{API}/bot{TOKEN}/{method}", data=json.dumps(params).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.load(r)
    if not data.get("ok"):
        sys.exit(f"Telegram {method}: {data.get('description')}")
    return data["result"]


call("setWebhook", url=f"{URL}?r=tg", secret_token=webhook_secret(TOKEN),
     allowed_updates=["message", "callback_query"], max_connections=10)
call("setMyCommands", commands=[{"command": c, "description": d} for c, d in COMMANDS])
call("setMyShortDescription", short_description="Запись на съёмку к фотографу Ваагу, Санкт-Петербург")
call("setMyDescription", description=(
    "Портретный фотограф в Санкт-Петербурге.\n\n"
    "Здесь можно выбрать пакет, свободный день и время и записаться на съёмку, "
    "посмотреть прайс и портфолио. Нажмите «Старт»."
))
info = call("getWebhookInfo")
print(f"Вебхук: {info['url'].split('?')[0]}?r=tg, ожидают обработки: {info.get('pending_update_count', 0)}")
