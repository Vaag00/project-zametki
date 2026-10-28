import sqlite3
import tarfile

from app import backup

from .conftest import booking_body


def test_backup_contains_db_and_photos(client, free):
    d, t = free
    client.post("/api/bookings", json=booking_body(d, t))
    archive = backup.main()
    with tarfile.open(archive) as tar:
        names = tar.getnames()
        assert "vaag.db" in names and any(n.startswith("media/") and n.endswith(".jpg") for n in names)
        tar.extract("vaag.db", archive.parent / "x", filter="data")
    rows = sqlite3.connect(archive.parent / "x" / "vaag.db").execute("SELECT name FROM bookings").fetchall()
    assert rows == [("Анна",)]
