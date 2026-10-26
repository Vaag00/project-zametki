"""Хранилище заявок: YDB в Яндекс Облаке, в тестах — в памяти.

Таблицы:
  bookings — заявки, ключ token;
  slots    — занятые окошки (date, time) → token. Запись в неё — защита от двойной записи:
             второй INSERT того же окошка не пройдёт, даже если два клиента нажали одновременно;
  kv       — мелочи: chat id фотографа, закрытые дни, шаги диалога в боте, счётчики заявок.
"""
import json
import os
import threading
import time

BOOKING_FIELDS = {
    "token": "Utf8", "created": "Int64", "package_id": "Utf8", "package_name": "Utf8", "package_price": "Int64",
    "date": "Utf8", "time": "Utf8", "name": "Utf8", "contact": "Utf8", "comment": "Utf8", "status": "Utf8",
    "source": "Utf8", "client_chat": "Int64", "owner_msg": "Int64", "ip_hash": "Utf8",
}


class SlotTaken(Exception):
    """Окошко уже занято другой заявкой."""


class Store:
    def get(self, key: str) -> str | None: ...
    def put(self, key: str, value: str | None) -> None: ...
    def create_booking(self, b: dict) -> None: ...
    def get_booking(self, token: str) -> dict | None: ...
    def update_booking(self, token: str, **fields) -> None: ...
    def cancel_booking(self, token: str) -> None: ...
    def taken(self, first_date: str) -> set[tuple[str, str]]: ...
    def bookings_from(self, first_date: str) -> list[dict]: ...

    # ---- поверх kv ----

    def get_json(self, key: str, default=None):
        raw = self.get(key)
        return default if raw is None else json.loads(raw)

    def put_json(self, key: str, value) -> None:
        self.put(key, None if value is None else json.dumps(value, ensure_ascii=False))

    def closed_days(self) -> set[str]:
        return set(self.get_json("closed", []))

    def set_closed_days(self, days: set[str]) -> None:
        self.put_json("closed", sorted(days))

    def owner_chat(self) -> int | None:
        v = self.get("owner")
        return int(v) if v else None


class MemoryStore(Store):
    def __init__(self):
        self.kv: dict[str, str] = {}
        self.bookings: dict[str, dict] = {}
        self.slots: dict[tuple[str, str], str] = {}
        self.lock = threading.Lock()

    def get(self, key):
        return self.kv.get(key)

    def put(self, key, value):
        if value is None:
            self.kv.pop(key, None)
        else:
            self.kv[key] = value

    def create_booking(self, b):
        with self.lock:
            if (b["date"], b["time"]) in self.slots:
                raise SlotTaken()
            self.slots[(b["date"], b["time"])] = b["token"]
            self.bookings[b["token"]] = {f: b.get(f) for f in BOOKING_FIELDS}

    def get_booking(self, token):
        b = self.bookings.get(token)
        return dict(b) if b else None

    def update_booking(self, token, **fields):
        self.bookings[token].update(fields)

    def cancel_booking(self, token):
        with self.lock:
            b = self.bookings[token]
            b["status"] = "cancelled"
            if self.slots.get((b["date"], b["time"])) == token:
                del self.slots[(b["date"], b["time"])]

    def taken(self, first_date):
        return {s for s in self.slots if s[0] >= first_date}

    def bookings_from(self, first_date):
        return sorted((dict(b) for b in self.bookings.values() if b["date"] >= first_date),
                      key=lambda b: (b["date"], b["time"]))


class YdbStore(Store):
    """YDB (serverless). Таблицы создаются сами при первом запуске."""

    def __init__(self, endpoint: str, database: str):
        import ydb

        self.ydb = ydb
        self.driver = ydb.Driver(endpoint=endpoint, database=database,
                                 credentials=ydb.credentials_from_env_variables())
        self.driver.wait(timeout=10, fail_fast=True)
        self.pool = ydb.QuerySessionPool(self.driver)
        self._ensure_tables()

    def _ensure_tables(self):
        cols = ",\n".join(f"{name} {t}" for name, t in BOOKING_FIELDS.items())
        for ddl in (
            f"CREATE TABLE IF NOT EXISTS bookings ({cols}, PRIMARY KEY (token))",
            "CREATE TABLE IF NOT EXISTS slots (date Utf8, time Utf8, token Utf8, PRIMARY KEY (date, time))",
            "CREATE TABLE IF NOT EXISTS kv (k Utf8, v Utf8, PRIMARY KEY (k))",
        ):
            self.pool.execute_with_retries(ddl)

    def _param(self, name: str, value, kind: str):
        t = getattr(self.ydb.PrimitiveType, kind)
        return f"${name}", (value, self.ydb.OptionalType(t))

    def _q(self, query: str, params: dict[str, tuple] | None = None) -> list[dict]:
        """params: {"name": (value, "Utf8")}. Возвращает строки первого результата."""
        params = params or {}
        declares = "".join(f"DECLARE ${n} AS Optional<{k}>;\n" for n, (_, k) in params.items())
        typed = dict(self._param(n, v, k) for n, (v, k) in params.items())
        result = self.pool.execute_with_retries(declares + query, typed)
        if not result:
            return []
        cols = [c.name for c in result[0].columns]
        return [{c: row[c] for c in cols} for row in result[0].rows]

    def get(self, key):
        rows = self._q("SELECT v FROM kv WHERE k = $k", {"k": (key, "Utf8")})
        return rows[0]["v"] if rows else None

    def put(self, key, value):
        if value is None:
            self._q("DELETE FROM kv WHERE k = $k", {"k": (key, "Utf8")})
        else:
            self._q("UPSERT INTO kv (k, v) VALUES ($k, $v)", {"k": (key, "Utf8"), "v": (value, "Utf8")})

    def create_booking(self, b):
        params = {f: (b.get(f), t) for f, t in BOOKING_FIELDS.items()}
        names = ", ".join(BOOKING_FIELDS)
        values = ", ".join(f"${f}" for f in BOOKING_FIELDS)
        try:
            # Одна транзакция: окошко занимается вместе с заявкой или не занимается вовсе
            self._q(f"INSERT INTO slots (date, time, token) VALUES ($date, $time, $token);\n"
                    f"INSERT INTO bookings ({names}) VALUES ({values});", params)
        except self.ydb.PreconditionFailed as err:
            raise SlotTaken() from err

    def get_booking(self, token):
        rows = self._q("SELECT * FROM bookings WHERE token = $token", {"token": (token, "Utf8")})
        return rows[0] if rows else None

    def update_booking(self, token, **fields):
        sets = ", ".join(f"{f} = ${f}" for f in fields)
        params = {f: (v, BOOKING_FIELDS[f]) for f, v in fields.items()}
        params["token"] = (token, "Utf8")
        self._q(f"UPDATE bookings SET {sets} WHERE token = $token", params)

    def cancel_booking(self, token):
        b = self.get_booking(token)
        self._q("UPDATE bookings SET status = 'cancelled' WHERE token = $token;\n"
                "DELETE FROM slots WHERE date = $date AND time = $time AND token = $token;",
                {"token": (token, "Utf8"), "date": (b["date"], "Utf8"), "time": (b["time"], "Utf8")})

    def taken(self, first_date):
        rows = self._q("SELECT date, time FROM slots WHERE date >= $d", {"d": (first_date, "Utf8")})
        return {(r["date"], r["time"]) for r in rows}

    def bookings_from(self, first_date):
        return self._q("SELECT * FROM bookings WHERE date >= $d ORDER BY date, time", {"d": (first_date, "Utf8")})


_store: Store | None = None


def get_store() -> Store:
    """Одно подключение на весь экземпляр функции — оно переживает вызовы."""
    global _store
    if _store is None:
        endpoint, database = os.environ.get("YDB_ENDPOINT"), os.environ.get("YDB_DATABASE")
        if not (endpoint and database):
            # Без базы заявки потерялись бы при перезапуске — в облаке так работать нельзя
            raise RuntimeError("Не заданы YDB_ENDPOINT и YDB_DATABASE")
        _store = YdbStore(endpoint, database)
    return _store


def now_ts() -> int:
    return int(time.time())
