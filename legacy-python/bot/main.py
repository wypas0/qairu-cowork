"""Точка входа QairuCowork."""

from __future__ import annotations

import asyncio
import logging

from telegram import BotCommand, BotCommandScopeAllGroupChats, BotCommandScopeAllPrivateChats, Update
from telegram.ext import AIORateLimiter, Application, ApplicationBuilder, CommandHandler, PicklePersistence

from qairu.config import Settings
from qairu.db import repo
from .handlers import availability, common, meeting, registration, schedule

log = logging.getLogger(__name__)

PRIVATE_COMMANDS = [
    ("start", "Начать / Бастау / Start"),
    ("schedule", "Заполнить расписание"),
    ("wizard", "Мастер по дням"),
    ("myschedule", "Моё расписание"),
    ("busy", "Занятость на дату или период"),
    ("availability", "Общие окна"),
    ("clear", "Очистить расписание"),
    ("lang", "Язык / Тіл / Language"),
    ("help", "Помощь"),
]

GROUP_COMMANDS = [
    ("setup", "Подключить чат"),
    ("join", "Присоединиться"),
    ("availability", "Общие свободные окна"),
    ("meeting", "Создать встречу"),
    ("free", "То же, что /availability"),
    ("members", "Кто заполнил расписание"),
    ("link", "Ссылка на веб-версию"),
    ("leave", "Выйти из списка участников"),
    ("remind", "Напомнить незаполнившим"),
    ("settings", "Настройки чата"),
    ("lang", "Язык / Тіл / Language"),
    ("help", "Помощь"),
]


async def _post_init(app: Application) -> None:
    await repo.create_schema()
    await meeting.restore_reminders(app)
    await app.bot.set_my_commands(
        [BotCommand(name, description) for name, description in PRIVATE_COMMANDS],
        scope=BotCommandScopeAllPrivateChats(),
    )
    await app.bot.set_my_commands(
        [BotCommand(name, description) for name, description in GROUP_COMMANDS],
        scope=BotCommandScopeAllGroupChats(),
    )
    me = await app.bot.get_me()
    log.info("QairuCowork запущен как @%s", me.username)


async def _post_shutdown(app: Application) -> None:
    await repo.dispose()


def build_application(settings: Settings) -> Application:
    repo.init_engine(settings.database_url)

    persistence = PicklePersistence(filepath=settings.persistence_path)
    app = (
        ApplicationBuilder()
        .token(settings.bot_token)
        .persistence(persistence)
        .rate_limiter(AIORateLimiter())
        .post_init(_post_init)
        .post_shutdown(_post_shutdown)
        .build()
    )

    # Порядок важен: общие команды, регистрация, окна, встречи, затем ввод расписания
    # (его MessageHandler ловит любой свободный текст в личке и должен быть последним).
    app.bot_data["web_base_url"] = settings.web_base_url

    common.register(app)
    registration.register(app)
    availability.register(app)
    meeting.register(app)
    schedule.register(app)
    app.add_handler(CommandHandler("cancel", common.cmd_cancel), group=2)
    return app


def main() -> None:
    settings = Settings.from_env()
    logging.basicConfig(
        format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)

    app = build_application(settings)
    app.run_polling(allowed_updates=Update.ALL_TYPES, drop_pending_updates=True)


if __name__ == "__main__":
    main()
