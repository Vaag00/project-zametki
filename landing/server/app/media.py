"""Загрузка фото: поворот по EXIF, две версии JPEG (для просмотра и для сетки), без метаданных."""
import io
import secrets

from PIL import Image, ImageOps, UnidentifiedImageError

from .config import settings

MAX_UPLOAD_BYTES = 30 * 1024 * 1024
FULL_SIZE = 1800
SMALL_SIZE = 900


class BadImage(ValueError):
    pass


def save_photo(data: bytes) -> tuple[str, int, int]:
    """Сохраняет фото в media/. Возвращает (имя файла без расширения, ширина, высота)."""
    if len(data) > MAX_UPLOAD_BYTES:
        raise BadImage("Файл больше 30 МБ.")
    try:
        with Image.open(io.BytesIO(data)) as im:
            im.load()
            img = ImageOps.exif_transpose(im).convert("RGB")
    except (UnidentifiedImageError, OSError) as err:
        raise BadImage("Это не фото (поддерживаются JPEG, PNG, WebP).") from err

    name = secrets.token_hex(8)
    for size, suffix, quality in ((FULL_SIZE, "", 84), (SMALL_SIZE, "-sm", 80)):
        copy = img.copy()
        copy.thumbnail((size, size), Image.Resampling.LANCZOS)
        copy.save(settings.media_dir / f"{name}{suffix}.jpg", "JPEG", quality=quality, optimize=True, progressive=True)
    w, h = img.size
    return name, w, h


def delete_photo_files(name: str) -> None:
    for suffix in ("", "-sm"):
        (settings.media_dir / f"{name}{suffix}.jpg").unlink(missing_ok=True)
