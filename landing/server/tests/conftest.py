import io
import json
import os
from pathlib import Path

import httpx
import pytest
from PIL import Image

# Настройки до импорта приложения
os.environ.update({
    "ADMIN_PASSWORD": "secret-pass",
    "TELEGRAM_BOT_TOKEN": "TEST",
    "TELEGRAM_OWNER_CHAT_ID": "42",
    "TELEGRAM_POLLING": "0",
    "SEED_DIR": str(Path(__file__).resolve().parents[2] / "public" / "portfolio"),
})

from fastapi.testclient import TestClient  # noqa: E402

from app import main, telegram  # noqa: E402
from app.config import settings  # noqa: E402


class FakeTelegram:
    """Подменяет Bot API: запоминает вызовы, умеет «падать»."""

    def __init__(self):
        self.calls: list[tuple[str, dict]] = []
        self.down = False
        self.next_id = 100

    def handler(self, request: httpx.Request) -> httpx.Response:
        method = request.url.path.rsplit("/", 1)[-1]
        params = json.loads(request.content or b"{}")
        if self.down:
            return httpx.Response(502, json={"ok": False, "description": "down"})
        self.calls.append((method, params))
        if method == "sendMessage":
            self.next_id += 1
            return httpx.Response(200, json={"ok": True, "result": {"message_id": self.next_id}})
        if method == "getMe":
            return httpx.Response(200, json={"ok": True, "result": {"username": "vaag_test_bot"}})
        return httpx.Response(200, json={"ok": True, "result": True})

    def sent(self, method: str = "sendMessage") -> list[dict]:
        return [p for m, p in self.calls if m == method]


@pytest.fixture
def tg():
    fake = FakeTelegram()
    telegram.tg.client = httpx.Client(transport=httpx.MockTransport(fake.handler))
    telegram.tg.username = "vaag_test_bot"
    return fake


@pytest.fixture
def client(tmp_path, tg):
    settings.data_dir = tmp_path
    main._login_attempts.clear()
    with TestClient(main.app) as c:
        yield c


@pytest.fixture
def admin(client):
    r = client.post("/api/admin/login", json={"password": "secret-pass"})
    assert r.status_code == 200
    return client


@pytest.fixture
def free(client):
    """Первые свободные (дата, время)."""
    data = client.get("/api/slots").json()
    for d, times in data["slots"].items():
        if times:
            return d, times[0]
    raise AssertionError("нет свободных окошек")


def booking_body(day: str, slot: str, **extra) -> dict:
    return {"packageId": "standard", "date": day, "time": slot, "name": "Анна", "contact": "@anna",
            "comment": "Хочу у воды", "consent": True, **extra}


def jpeg_bytes(w=2400, h=1600) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (40, 50, 45)).save(buf, "JPEG")
    return buf.getvalue()
