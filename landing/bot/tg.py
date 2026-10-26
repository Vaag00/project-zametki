"""Вызовы Telegram Bot API. Без сторонних библиотек — только стандартный urllib."""
import json
import logging
import os
import urllib.error
import urllib.request

log = logging.getLogger("vaag.tg")


class Telegram:
    def __init__(self, token: str | None = None, api: str | None = None):
        self.token = token if token is not None else os.environ.get("TELEGRAM_BOT_TOKEN", "")
        self.api = api or os.environ.get("TELEGRAM_API", "https://api.telegram.org")

    def call(self, method: str, **params):
        """Результат метода или None при ошибке (ошибка пишется в лог)."""
        if not self.token:
            return None
        req = urllib.request.Request(
            f"{self.api}/bot{self.token}/{method}",
            data=json.dumps(params).encode(),
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=8) as r:
                data = json.load(r)
        except urllib.error.HTTPError as err:
            try:
                data = json.load(err)
            except ValueError:
                data = {"ok": False, "description": str(err)}
        except (OSError, ValueError) as err:
            log.warning("Telegram %s: %s", method, err)
            return None
        if not data.get("ok"):
            log.warning("Telegram %s: %s", method, data.get("description"))
            return None
        return data["result"]

    def send(self, chat_id: int, text: str, buttons: list | None = None) -> int | None:
        params = {"chat_id": chat_id, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True}
        if buttons is not None:
            params["reply_markup"] = {"inline_keyboard": buttons}
        res = self.call("sendMessage", **params)
        return res["message_id"] if res else None

    def edit(self, chat_id: int, message_id: int, text: str, buttons: list | None = None) -> bool:
        res = self.call("editMessageText", chat_id=chat_id, message_id=message_id, text=text, parse_mode="HTML",
                        disable_web_page_preview=True, reply_markup={"inline_keyboard": buttons or []})
        return res is not None

    def answer(self, callback_id: str, text: str | None = None) -> None:
        self.call("answerCallbackQuery", callback_query_id=callback_id, **({"text": text} if text else {}))
