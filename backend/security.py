import hashlib
import hmac
import os
import secrets

# Параметры scrypt (≈16 МБ памяти на хеш)
_N, _R, _P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=_N, r=_R, p=_P)
    return hmac.compare_digest(digest.hex(), digest_hex)


# Хеш-заглушка: проверяем пароль и для несуществующего пользователя,
# чтобы по времени ответа нельзя было понять, зарегистрирован ли логин
DUMMY_HASH = hash_password(secrets.token_hex(8))


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    # В БД храним только хеш токена: утечка базы не даёт доступа к сессиям
    return hashlib.sha256(token.encode()).hexdigest()
