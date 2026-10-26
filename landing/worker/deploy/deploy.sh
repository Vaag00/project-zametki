#!/usr/bin/env bash
# Развёртывание бота в Cloudflare: база D1, Worker, вебхук Telegram.
# Повторный запуск безопасен: база создаётся только в первый раз, заявки сохраняются.
# Нужны: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, TELEGRAM_BOT_TOKEN.
set -euo pipefail
cd "$(dirname "$0")/.."

WORKER=vaag-bot
DATABASE=vaag-bot

cf() { curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
  "${CLOUDFLARE_API:-https://api.cloudflare.com/client/v4}/accounts/$CLOUDFLARE_ACCOUNT_ID/$@"; }
field() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const v=($1)(JSON.parse(s));console.log(v??'')}catch{console.log('')}})"; }

bot_username=$(curl -sS "${TELEGRAM_API:-https://api.telegram.org}/bot${TELEGRAM_BOT_TOKEN}/getMe" | field 'j=>j.result.username')
if [ -z "$bot_username" ]; then
  echo "::error::Telegram не принял токен бота. Проверьте секрет TELEGRAM_BOT_TOKEN."; exit 1
fi
echo "Бот: @$bot_username"

# ---- База D1 ----
db_id() { npx wrangler d1 list --json 2>/dev/null | field "l=>l.find(d=>d.name==='$DATABASE')?.uuid"; }
id=$(db_id)
if [ -z "$id" ]; then
  echo "Создаю базу D1…"
  npx wrangler d1 create "$DATABASE" >/dev/null
  id=$(db_id)
fi
[ -n "$id" ] || { echo "::error::Не удалось создать базу D1. Проверьте, что у токена есть право D1: Edit."; exit 1; }
sed -i "s/^database_id = .*/database_id = \"$id\"/" wrangler.toml
npx wrangler d1 execute "$DATABASE" --remote --file schema.sql --yes >/dev/null
echo "База: $id"

# ---- Адрес *.workers.dev: у новой учётной записи его может не быть — создаём ----
sub=$(cf workers/subdomain | field 'j=>j.result?.subdomain')
if [ -z "$sub" ]; then
  for name in vaag-ph vaag-ph-bot "vaag-ph-$RANDOM"; do
    sub=$(cf workers/subdomain -X PUT -d "{\"subdomain\":\"$name\"}" | field 'j=>j.success?j.result.subdomain:null')
    [ -n "$sub" ] && break
  done
fi
[ -n "$sub" ] || { echo "::error::Не удалось получить адрес workers.dev. Откройте Workers & Pages в панели Cloudflare один раз и запустите снова."; exit 1; }

# ---- Worker ----
npx wrangler deploy --var "BOT_USERNAME:$bot_username"
printf '%s' "$TELEGRAM_BOT_TOKEN" | npx wrangler secret put TELEGRAM_BOT_TOKEN >/dev/null
url="${WORKER_URL:-https://$WORKER.$sub.workers.dev}"
echo "Worker: $url"

# ---- Проверка: Worker отвечает и видит базу (новый адрес workers.dev может появиться не сразу) ----
for attempt in $(seq 1 12); do
  curl -sSf "$url/?r=slots" -o /dev/null 2>/dev/null && break
  [ "$attempt" = 12 ] && { echo "::error::Worker не отвечает: $url. Логи — панель Cloudflare → Workers & Pages → $WORKER → Logs"; exit 1; }
  sleep 10
done
echo "Worker работает, база подключена"

WORKER_URL="$url" node deploy/setup-telegram.mjs
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && cat >> "$GITHUB_STEP_SUMMARY" <<SUMMARY
### Бот запущен: [@$bot_username](https://t.me/$bot_username)

Адрес Worker: \`$url\`

Напишите боту /start со своего аккаунта @vaaaaaag — он запомнит вас как фотографа.
SUMMARY
echo "Готово: https://t.me/$bot_username"
