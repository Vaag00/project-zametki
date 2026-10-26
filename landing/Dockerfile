# Сайт + сервер в одном образе. Сборка: docker compose build (см. DEPLOY.md)

# 1. Собираем сайт
FROM node:22-alpine AS web
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
COPY shared ./shared
COPY public ./public
# Адрес сайта для превью ссылок — из SITE_URL в .env (передаёт docker-compose.yml)
ARG SITE_URL=https://vaag-ph.duckdns.org
ENV VITE_SITE_URL=$SITE_URL
RUN npm run build

# 2. Сервер
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    DATA_DIR=/data STATIC_DIR=/app/static SEED_DIR=/app/seed
WORKDIR /app
COPY server/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY server/app ./app
COPY --from=web /web/dist ./static
# Фото портфолио для первого запуска (дальше — через админку)
COPY public/portfolio ./seed
RUN useradd --system --uid 1000 vaag && mkdir -p /data && chown vaag /data
USER vaag
VOLUME /data
EXPOSE 8000
# Один процесс: бот Telegram получает сообщения в фоновом потоке, ему нужен ровно один экземпляр
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
