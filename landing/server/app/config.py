"""Настройки из переменных окружения (файл .env на сервере)."""
import os
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


@dataclass
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(_env("DATA_DIR", str(HERE.parent / "data"))))
    # Собранный сайт (npm run build → dist). Пусто — сервер отдаёт только API.
    static_dir: Path | None = field(default_factory=lambda: Path(p) if (p := _env("STATIC_DIR")) else None)
    # Фото для первого запуска (портфолио по умолчанию)
    seed_dir: Path = field(default_factory=lambda: Path(_env("SEED_DIR", str(HERE.parent.parent / "public" / "portfolio"))))
    admin_password: str = field(default_factory=lambda: _env("ADMIN_PASSWORD"))
    telegram_token: str = field(default_factory=lambda: _env("TELEGRAM_BOT_TOKEN"))
    telegram_owner_chat_id: int | None = field(
        default_factory=lambda: int(v) if (v := _env("TELEGRAM_OWNER_CHAT_ID")).lstrip("-").isdigit() else None
    )
    telegram_api: str = field(default_factory=lambda: _env("TELEGRAM_API", "https://api.telegram.org"))
    # Включить получение сообщений бота (кнопки, подписка клиентов). В тестах выключено.
    telegram_polling: bool = field(default_factory=lambda: _env("TELEGRAM_POLLING", "1") == "1")
    site_url: str = field(default_factory=lambda: _env("SITE_URL", "http://localhost:8000").rstrip("/"))
    cookie_secure: bool = field(default_factory=lambda: _env("COOKIE_SECURE", "0") == "1")

    @property
    def db_path(self) -> Path:
        return self.data_dir / "vaag.db"

    @property
    def media_dir(self) -> Path:
        return self.data_dir / "media"


settings = Settings()
