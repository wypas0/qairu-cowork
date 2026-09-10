"""Модели данных QairuCowork (SQLAlchemy 2.0)."""

from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UtcDateTime(TypeDecorator):
    """Дата-время, которое всегда возвращается в UTC и всегда с tzinfo.

    SQLite не хранит смещение: `UtcDateTime()` кладёт туда наивную
    строку, и после чтения tzinfo теряется. Дальше это ломает всё сразу —
    время встречи уезжает на величину смещения, а сравнение naive и aware
    дат при восстановлении напоминаний падает с TypeError. Поэтому приводим
    к UTC на записи и навешиваем UTC на чтении.
    """

    impl = DateTime
    cache_ok = True

    def __init__(self):
        super().__init__(timezone=True)

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            # Наивное значение считаем UTC: другой трактовки у нас нет.
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    user_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    username: Mapped[str | None] = mapped_column(String(64))
    full_name: Mapped[str] = mapped_column(String(256), default="")
    lang: Mapped[str] = mapped_column(String(8), default="ru")
    # Пользователь, заведённый на сайте без Telegram. Его user_id — синтетический
    # (см. new_web_id): Telegram такие никогда не выдаёт, коллизий быть не может.
    is_web: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime(), default=utcnow)

    slots: Mapped[list["BusySlot"]] = relationship(back_populates="user", cascade="all, delete-orphan")

    @property
    def display(self) -> str:
        return self.full_name or (f"@{self.username}" if self.username else str(self.user_id))


class Chat(Base):
    __tablename__ = "chats"

    chat_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    # Короткий публичный идентификатор для ссылки /g/<slug>. Один и тот же
    # объект Chat — это и группа в Telegram, и группа на сайте.
    slug: Mapped[str | None] = mapped_column(String(24), unique=True, index=True)
    origin: Mapped[str] = mapped_column(String(16), default="telegram")   # telegram | web
    title: Mapped[str] = mapped_column(String(256), default="")
    lang: Mapped[str] = mapped_column(String(8), default="ru")
    tz: Mapped[str] = mapped_column(String(64), default="Asia/Almaty")
    day_start_min: Mapped[int] = mapped_column(Integer, default=8 * 60)
    day_end_min: Mapped[int] = mapped_column(Integer, default=22 * 60)
    min_slot_min: Mapped[int] = mapped_column(Integer, default=30)
    travel_buffer_min: Mapped[int] = mapped_column(Integer, default=0)   # буфер на дорогу
    semester_start: Mapped[date | None] = mapped_column(Date)            # отсчёт чётности недель
    reminder_min: Mapped[int] = mapped_column(Integer, default=30)       # напоминание до встречи
    created_at: Mapped[datetime] = mapped_column(UtcDateTime(), default=utcnow)


class Membership(Base):
    __tablename__ = "memberships"

    chat_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("chats.chat_id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id", ondelete="CASCADE"), primary_key=True)
    joined_at: Mapped[datetime] = mapped_column(UtcDateTime(), default=utcnow)


class BusySlot(Base):
    """Занятость. Ровно одно из (weekday, specific_date) не NULL."""

    __tablename__ = "busy_slots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id", ondelete="CASCADE"), index=True)
    weekday: Mapped[int | None] = mapped_column(Integer)          # 0=Пн … 6=Вс
    specific_date: Mapped[date | None] = mapped_column(Date)
    date_from: Mapped[date | None] = mapped_column(Date)          # диапазон: сессия, поездка
    date_to: Mapped[date | None] = mapped_column(Date)
    week_parity: Mapped[int | None] = mapped_column(Integer)      # None=каждую, 0=числ., 1=знам.
    start_min: Mapped[int] = mapped_column(Integer)
    end_min: Mapped[int] = mapped_column(Integer)
    label: Mapped[str] = mapped_column(String(64), default="")
    kind: Mapped[str] = mapped_column(String(16), default="class")    # class|work|sport|exam|other
    source: Mapped[str] = mapped_column(String(16), default="wizard")  # wizard | import | csv
    created_at: Mapped[datetime] = mapped_column(UtcDateTime(), default=utcnow)

    user: Mapped[User] = relationship(back_populates="slots")


Index("ix_busy_user_weekday", BusySlot.user_id, BusySlot.weekday)


class ScheduleState(Base):
    """Отметка «пользователь завершил заполнение расписания».

    Нужна, чтобы отличать «свободен всю неделю» от «не заполнял».
    """

    __tablename__ = "schedule_state"

    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id", ondelete="CASCADE"), primary_key=True)
    filled: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime(), default=utcnow, onupdate=utcnow)


class WebSession(Base):
    """Персональная ссылка/кука сайта. Аккаунтов и паролей нет — только токен."""

    __tablename__ = "web_sessions"

    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id", ondelete="CASCADE"),
                                         index=True)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime(), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(UtcDateTime(), default=utcnow,
                                                   onupdate=utcnow)


class Meeting(Base):
    __tablename__ = "meetings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    chat_id: Mapped[int] = mapped_column(BigInteger, index=True)
    initiator_id: Mapped[int] = mapped_column(BigInteger)
    place: Mapped[str] = mapped_column(String(256), default="")
    when_text: Mapped[str] = mapped_column(String(256), default="")
    when_start: Mapped[datetime | None] = mapped_column(UtcDateTime())
    goal: Mapped[str] = mapped_column(Text, default="")
    chat_message_id: Mapped[int | None] = mapped_column(BigInteger)
    invitees: Mapped[str] = mapped_column(Text, default="")   # "123,456" — id приглашённых
    status: Mapped[str] = mapped_column(String(16), default="open")  # open | cancelled | done
    created_at: Mapped[datetime] = mapped_column(UtcDateTime(), default=utcnow)

    responses: Mapped[list["MeetingResponse"]] = relationship(
        back_populates="meeting", cascade="all, delete-orphan", lazy="selectin"
    )

    def invitee_ids(self) -> list[int]:
        return [int(part) for part in self.invitees.split(",") if part.strip()]


class MeetingResponse(Base):
    __tablename__ = "meeting_responses"

    meeting_id: Mapped[int] = mapped_column(Integer, ForeignKey("meetings.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    answer: Mapped[str] = mapped_column(String(16))       # yes | no | change
    comment: Mapped[str] = mapped_column(Text, default="")
    responded_at: Mapped[datetime] = mapped_column(UtcDateTime(), default=utcnow, onupdate=utcnow)

    meeting: Mapped[Meeting] = relationship(back_populates="responses")
