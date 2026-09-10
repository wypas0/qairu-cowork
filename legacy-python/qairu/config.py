"""Конфигурация из переменных окружения."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    """Минимальный .env-лоадер, чтобы не тянуть python-dotenv."""
    env_path = BASE_DIR / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()


@dataclass(frozen=True)
class Settings:
    bot_token: str
    database_url: str
    default_tz: str
    default_lang: str
    day_start_min: int
    day_end_min: int
    min_slot_min: int
    persistence_path: str
    log_level: str
    web_base_url: str
    web_secret: str

    @staticmethod
    def from_env_web() -> "Settings":
        """Настройки для сайта: BOT_TOKEN не обязателен.

        Без него работает всё, кроме входа через Telegram Mini App —
        подпись initData проверить нечем.
        """
        return Settings._build(require_token=False)

    @staticmethod
    def from_env() -> "Settings":
        return Settings._build(require_token=True)

    @staticmethod
    def _build(require_token: bool) -> "Settings":
        token = os.getenv("BOT_TOKEN", "").strip()
        if not token and require_token:
            raise RuntimeError(
                "BOT_TOKEN не задан. Создай .env по образцу .env.example "
                "и положи туда токен от @BotFather."
            )
        return Settings(
            bot_token=token,
            database_url=os.getenv("DATABASE_URL", f"sqlite+aiosqlite:///{BASE_DIR / 'qairu.db'}"),
            default_tz=os.getenv("DEFAULT_TZ", "Asia/Almaty"),
            default_lang=os.getenv("DEFAULT_LANG", "ru"),
            day_start_min=_hhmm_to_min(os.getenv("DAY_START", "08:00")),
            day_end_min=_hhmm_to_min(os.getenv("DAY_END", "22:00")),
            min_slot_min=int(os.getenv("MIN_SLOT", "30")),
            persistence_path=os.getenv("PERSISTENCE_PATH", str(BASE_DIR / "qairu_state.pickle")),
            log_level=os.getenv("LOG_LEVEL", "INFO"),
            web_base_url=os.getenv("WEB_BASE_URL", "").rstrip("/"),
            web_secret=os.getenv("WEB_SECRET", ""),
        )


def _hhmm_to_min(value: str) -> int:
    hours, _, minutes = value.partition(":")
    return int(hours) * 60 + int(minutes or 0)
