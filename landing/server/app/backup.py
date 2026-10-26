"""Резервная копия: база (через SQLite backup, безопасно на работающем сервере) + фото.

Запуск на сервере:  docker compose exec app python -m app.backup
Копии — в /data/backups (том data), хранятся последние 14.
"""
import sqlite3
import tarfile
from datetime import datetime
from pathlib import Path

from .config import settings

KEEP = 14


def main() -> Path:
    backups = settings.data_dir / "backups"
    backups.mkdir(mode=0o750, parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H-%M")
    db_copy = backups / f"vaag-{stamp}.db"
    src = sqlite3.connect(settings.db_path)
    dst = sqlite3.connect(db_copy)
    with dst:
        src.backup(dst)
    src.close()
    dst.close()

    archive = backups / f"vaag-{stamp}.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        tar.add(db_copy, arcname="vaag.db")
        tar.add(settings.media_dir, arcname="media")
    db_copy.unlink()

    for old in sorted(backups.glob("vaag-*.tar.gz"))[:-KEEP]:
        old.unlink()
    print(archive)
    return archive


if __name__ == "__main__":
    main()
