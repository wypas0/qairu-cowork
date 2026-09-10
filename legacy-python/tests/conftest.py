"""Общая настройка тестов: изолированная БД и фиктивный токен бота."""

import os
import tempfile

_TMP = tempfile.mkdtemp(prefix="qairu-tests-")
os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{_TMP}/test.db")
os.environ.setdefault("BOT_TOKEN", "123456:AAHtestTOKENtestTOKENtestTOKENtestTO")
os.environ.setdefault("PERSISTENCE_PATH", f"{_TMP}/state.pickle")
