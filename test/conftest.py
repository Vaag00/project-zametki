import os
import tempfile
import uuid
from pathlib import Path

# 1. Изолированная БД: временный каталог вместо боевой notes.db
_TMP_DIR = tempfile.mkdtemp(prefix="notes-tests-")
os.environ["NOTES_DB"] = str(Path(_TMP_DIR) / "test_notes.db")
os.environ["COOKIE_SECURE"] = ""  # в тестах HTTP, secure-cookie не нужна

import pytest
from fastapi.testclient import TestClient

# 2. Теперь безопасно импортировать приложение — оно подхватит тестовую БД
from backend.main import app


def _unique(name: str) -> str:
    """Уникальный логин на каждый вызов фикстуры (БД общая на сессию тестов)."""
    return f"{name}-{uuid.uuid4().hex[:8]}"


def _register(client, username: str, password: str = "secret-password"):
    r = client.post("/api/auth/register",
                    json={"username": username, "password": password})
    assert r.status_code == 201, r.text
    return r


@pytest.fixture(scope="session")
def client():
    # TestClient как контекстный менеджер запускает lifespan -> init_db()
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def user_alice(client):
    """Свежий клиент с залогиненной Алисой (у каждого теста свои cookie
    и свой пользователь)."""
    c = TestClient(app)
    with c:
        _register(c, _unique("alice"))
        yield c


@pytest.fixture()
def user_bob(client):
    c = TestClient(app)
    with c:
        _register(c, _unique("bob"))
        yield c


@pytest.fixture()
def alice_note(user_alice):
    """Одна заметка от имени Алисы."""
    r = user_alice.post("/api/notes", json={"title": "Покупки", "body": "молоко",
                                            "tags": ["Дом", "дом", " еда "]})
    assert r.status_code == 201, r.text
    return r.json()