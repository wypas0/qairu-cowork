FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY qairu ./qairu
COPY bot ./bot
COPY web ./web

ENV DATABASE_URL=sqlite+aiosqlite:////data/qairu.db \
    PERSISTENCE_PATH=/data/qairu_state.pickle
VOLUME ["/data"]

# Что запускать — решает docker-compose: бот или сайт.
CMD ["python", "-m", "bot.main"]
