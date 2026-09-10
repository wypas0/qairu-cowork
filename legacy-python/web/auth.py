"""Аутентификация сайта: токен-ссылка и вход из Telegram Mini App.

Аккаунтов и паролей нет. Личность подтверждается одним из двух способов:

1. Токен в куке `qairu_token` — выдаётся при создании группы, при входе по
   ссылке-приглашению и командой /link в боте.
2. `initData` из Telegram Mini App — подписанные Telegram данные, из которых
   достоверно берётся telegram user_id. Тогда веб и бот — один и тот же человек.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl

COOKIE_NAME = "qairu_token"
COOKIE_MAX_AGE = 60 * 60 * 24 * 365   # год
INITDATA_MAX_AGE = 60 * 60 * 24       # сутки


class InitDataError(Exception):
    pass


def verify_init_data(init_data: str, bot_token: str, max_age: int = INITDATA_MAX_AGE) -> dict:
    """Проверить подпись Telegram Mini App и вернуть разобранные поля.

    Алгоритм из документации Telegram:
      secret_key    = HMAC_SHA256(key="WebAppData", msg=bot_token)
      data_check    = "\\n".join(sorted("key=value" для всех полей, кроме hash))
      expected_hash = hex(HMAC_SHA256(key=secret_key, msg=data_check))

    Сравнение — постоянного времени; отдельно проверяется свежесть auth_date,
    иначе перехваченный initData работал бы вечно.
    """
    if not bot_token:
        raise InitDataError("BOT_TOKEN не задан — проверить подпись невозможно")

    pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = pairs.pop("hash", "")
    if not received_hash:
        raise InitDataError("в initData нет hash")

    data_check_string = "\n".join(f"{key}={pairs[key]}" for key in sorted(pairs))
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(expected, received_hash):
        raise InitDataError("подпись initData не совпала")

    auth_date = int(pairs.get("auth_date", "0") or 0)
    if max_age and (time.time() - auth_date) > max_age:
        raise InitDataError("initData просрочен")

    user_raw = pairs.get("user")
    if user_raw:
        try:
            pairs["user"] = json.loads(user_raw)
        except json.JSONDecodeError as error:
            raise InitDataError("не удалось разобрать поле user") from error
    return pairs


def set_token_cookie(response, token: str, secure: bool) -> None:
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=secure,
        path="/",
    )
