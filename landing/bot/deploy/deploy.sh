#!/usr/bin/env bash
# Развёртывание бота в Яндекс Облаке: база YDB, функция, вебхук Telegram.
# Повторный запуск безопасен: база и функция создаются только в первый раз, данные сохраняются.
# Нужны: вход через yc_login.sh (SA_ID), TELEGRAM_BOT_TOKEN, SITE_URL, OWNER_USERNAME.
set -euo pipefail

FUNCTION=${FUNCTION:-vaag-bot}
DATABASE=${DATABASE:-vaag-bot}
cd "$(dirname "$0")/.."

json() { python3 -c "import json,sys; print(json.load(sys.stdin)$1)"; }

bot_username=$(curl -sS "${TELEGRAM_API:-https://api.telegram.org}/bot${TELEGRAM_BOT_TOKEN}/getMe" | json '["result"]["username"]') || {
  echo "::error::Telegram не принял токен бота. Проверьте секрет TELEGRAM_BOT_TOKEN."; exit 1; }
echo "Бот: @$bot_username"

# ---- База ----
if ! yc ydb database get --name "$DATABASE" >/dev/null 2>&1; then
  echo "Создаю базу YDB (serverless) — пара минут…"
  yc ydb database create --name "$DATABASE" --serverless --description "Заявки на съёмку" >/dev/null
fi
endpoint=$(yc ydb database get --name "$DATABASE" --format json | json '["endpoint"]')
# grpcs://ydb.serverless.yandexcloud.net:2135/?database=/ru-central1/…
ydb_endpoint=$(python3 -c 'import sys; print(sys.argv[1].split("/?database=")[0])' "$endpoint")
ydb_database=$(python3 -c 'import sys; print(sys.argv[1].split("database=")[1])' "$endpoint")
echo "База: $ydb_database"

# ---- Функция ----
if ! yc serverless function get --name "$FUNCTION" >/dev/null 2>&1; then
  yc serverless function create --name "$FUNCTION" --description "Бот и запись VAAAAAAG" >/dev/null
fi
yc serverless function allow-unauthenticated-invoke --name "$FUNCTION" >/dev/null

build=$(mktemp -d)
cp index.py bot.py core.py store.py tg.py requirements.txt "$build/"
cp ../server/app/seed.json "$build/content.json"
(cd "$build" && zip -q -r bot.zip .)

env_vars="TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN},YDB_ENDPOINT=${ydb_endpoint},YDB_DATABASE=${ydb_database}"
env_vars+=",YDB_METADATA_CREDENTIALS=1,SITE_URL=${SITE_URL},OWNER_USERNAME=${OWNER_USERNAME},BOT_USERNAME=${bot_username}"

echo "Загружаю новую версию функции…"
yc serverless function version create \
  --function-name "$FUNCTION" \
  --runtime python312 \
  --entrypoint index.handler \
  --memory 256m \
  --execution-timeout 15s \
  --service-account-id "$SA_ID" \
  --source-path "$build/bot.zip" \
  --environment "$env_vars" >/dev/null

url=$(yc serverless function get --name "$FUNCTION" --format json | json '["http_invoke_url"]')
echo "Функция: $url"

# ---- Проверка: функция отвечает и видит базу ----
for attempt in 1 2 3; do
  if curl -sSf "${url}?r=slots" -o /dev/null; then break; fi
  [ "$attempt" = 3 ] && { echo "::error::Функция не отвечает. Логи: консоль Яндекс Облака → Cloud Functions → $FUNCTION → Логи"; exit 1; }
  sleep 5
done
echo "Функция работает, база подключена"

FUNCTION_URL="$url" python3 deploy/setup_telegram.py
[ -n "${GITHUB_OUTPUT:-}" ] && echo "url=$url" >> "$GITHUB_OUTPUT"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && cat >> "$GITHUB_STEP_SUMMARY" <<EOF
### Бот запущен: [@$bot_username](https://t.me/$bot_username)

Адрес функции: \`$url\`

Напишите боту /start со своего аккаунта @$OWNER_USERNAME — он запомнит вас как фотографа.
EOF
echo "Готово: https://t.me/$bot_username"
