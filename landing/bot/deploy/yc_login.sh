#!/usr/bin/env bash
# Ставит Yandex Cloud CLI и входит по ключу сервисного аккаунта из $YC_SA_KEY (JSON).
# Каталог (folder) берётся из самого аккаунта. Для GitHub Actions: пишет yc в PATH и SA_ID в окружение.
set -euo pipefail

if ! command -v yc >/dev/null; then
  curl -sSL https://storage.yandexcloud.net/yandexcloud-yc/install.sh | bash -s -- -i "$HOME/yc" -n >/dev/null
  export PATH="$HOME/yc/bin:$PATH"
  [ -n "${GITHUB_PATH:-}" ] && echo "$HOME/yc/bin" >> "$GITHUB_PATH"
fi

key="${RUNNER_TEMP:-/tmp}/yc-key.json"
printf '%s' "$YC_SA_KEY" > "$key"
chmod 600 "$key"
yc config set service-account-key "$key" >/dev/null

sa_id=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["service_account_id"])' "$key")
folder_id=$(yc iam service-account get --id "$sa_id" --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["folder_id"])')
yc config set folder-id "$folder_id" >/dev/null

[ -n "${GITHUB_ENV:-}" ] && echo "SA_ID=$sa_id" >> "$GITHUB_ENV"
echo "Вход в Яндекс Облако: каталог $folder_id"
