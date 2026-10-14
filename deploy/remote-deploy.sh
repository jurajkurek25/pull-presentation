#!/usr/bin/env bash
# Runs on the server as the site user. Uploaded and started by deploy.ps1:
#   bash remote-deploy.sh <config.env> <app.tar.gz>
set -euo pipefail

CONFIG="$1"
ARCHIVE="$2"
trap 'rm -f "$0" "$CONFIG" "$ARCHIVE"' EXIT # uploaded files, also on failure
# shellcheck disable=SC1090
source "$CONFIG"
rm -f "$CONFIG" # may contain the admin password

# CloudPanel installs Node.js per site user via nvm, which non-interactive SSH doesn't load.
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then . "$NVM_DIR/nvm.sh"; fi
if ! command -v node >/dev/null; then
  echo "CHYBA: Na serveri nie je Node.js. V CloudPanel vytvor stránku typu Node.js (verzia 20 alebo 22)." >&2
  exit 1
fi
if [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "CHYBA: Potrebný je Node.js 20 alebo novší, na serveri je $(node -v)." >&2
  exit 1
fi

echo "==> Rozbaľujem aplikáciu do $APP_DIR"
mkdir -p "$APP_DIR" "$DATA_DIR"
cd "$APP_DIR"
rm -rf src public scripts
tar -xzf "$ARCHIVE" -C "$APP_DIR"

echo "==> Inštalujem závislosti"
npm ci --omit=dev --no-audit --no-fund

export NODE_ENV=production PORT="$APP_PORT" PUBLIC_URL DB_FILE="$DATA_DIR/app.db"

if [ -n "${ADMIN_EMAIL:-}" ]; then
  echo "==> Vytváram admin účet $ADMIN_EMAIL"
  node scripts/create-user.js "$ADMIN_EMAIL" "$ADMIN_NAME" "$ADMIN_PASSWORD" ||
    echo "UPOZORNENIE: Účet sa nepodarilo vytvoriť (možno už existuje)." >&2
fi

# pm2 keeps the app running; installed into the user's home so no root is needed.
export PATH="$HOME/.local/bin:$PATH"
if ! command -v pm2 >/dev/null; then
  echo "==> Inštalujem pm2"
  npm install -g --prefix "$HOME/.local" pm2 --no-audit --no-fund
fi

echo "==> Spúšťam aplikáciu ($APP_NAME na porte $APP_PORT)"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$APP_NAME" --update-env
else
  pm2 start src/server.js --name "$APP_NAME"
fi
pm2 save

# Start again after a server reboot.
CRON_LINE="@reboot PATH=$(dirname "$(command -v node)"):\$PATH $(command -v pm2) resurrect"
if ! (crontab -l 2>/dev/null | grep -qF "pm2 resurrect"); then
  (crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab - ||
    echo "UPOZORNENIE: Nepodarilo sa nastaviť štart po reštarte servera (crontab)." >&2
fi

echo "==> Kontrolujem, či aplikácia beží"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "http://127.0.0.1:$APP_PORT/healthz" >/dev/null 2>&1; then
    echo "OK: Aplikácia beží na porte $APP_PORT. Admin: $PUBLIC_URL/admin"
    if [ "$(node -e "const D=require('better-sqlite3');console.log(new D(process.env.DB_FILE).prepare('SELECT COUNT(*) c FROM users').get().c)")" = "0" ]; then
      echo "UPOZORNENIE: Zatiaľ nie je žiadny admin účet. Spusti skript znova s prepínačom -CreateAdmin." >&2
    fi
    exit 0
  fi
  sleep 1
done
echo "CHYBA: Aplikácia neodpovedá na porte $APP_PORT. Výpis logov:" >&2
pm2 logs "$APP_NAME" --lines 30 --nostream >&2 || true
exit 1
