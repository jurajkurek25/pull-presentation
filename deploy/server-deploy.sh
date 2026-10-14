#!/usr/bin/env bash
# Deploy directly on the server, as root, from a clone of this repository:
#   bash deploy/server-deploy.sh                 # install / update
#   bash deploy/server-deploy.sh --create-admin  # also create an admin account
# The app is installed and run as the CloudPanel site user, not as root.
set -euo pipefail

SITE_USER="${SITE_USER:-jurajkurek-forms}"
APP_DIR="${APP_DIR:-/home/$SITE_USER/htdocs/forms.jurajkurek.com}"
DATA_DIR="${DATA_DIR:-/home/$SITE_USER/forms-data}"
APP_PORT="${APP_PORT:-9876}"
PUBLIC_URL="${PUBLIC_URL:-https://forms.jurajkurek.com}"
APP_NAME="${APP_NAME:-forms}"

if [ "$(id -u)" != 0 ]; then echo "CHYBA: Spusti ako root." >&2; exit 1; fi
if ! id "$SITE_USER" >/dev/null 2>&1; then echo "CHYBA: Používateľ $SITE_USER neexistuje." >&2; exit 1; fi

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SITE_HOME="$(getent passwd "$SITE_USER" | cut -d: -f6)"
ID="forms-deploy-$$"
umask 077

# Bash single-quoted string, safe for any value.
q() { printf "'%s'" "$(printf %s "$1" | sed "s/'/'\\\\''/g")"; }

{
  echo "APP_DIR=$(q "$APP_DIR")"
  echo "DATA_DIR=$(q "$DATA_DIR")"
  echo "APP_PORT=$(q "$APP_PORT")"
  echo "PUBLIC_URL=$(q "$PUBLIC_URL")"
  echo "APP_NAME=$(q "$APP_NAME")"
} > "$SITE_HOME/$ID.env"

if [ "${1:-}" = "--create-admin" ]; then
  read -rp 'E-mail admina: ' ADMIN_EMAIL
  read -rp 'Meno admina: ' ADMIN_NAME
  read -rsp 'Heslo admina (min. 8 znakov): ' ADMIN_PASSWORD; echo
  if [ "${#ADMIN_PASSWORD}" -lt 8 ]; then
    rm -f "$SITE_HOME/$ID.env"
    echo "CHYBA: Heslo musí mať aspoň 8 znakov." >&2
    exit 1
  fi
  {
    echo "ADMIN_EMAIL=$(q "$ADMIN_EMAIL")"
    echo "ADMIN_NAME=$(q "$ADMIN_NAME")"
    echo "ADMIN_PASSWORD=$(q "$ADMIN_PASSWORD")"
  } >> "$SITE_HOME/$ID.env"
fi

echo "==> Balím aplikáciu z $REPO"
tar -czf "$SITE_HOME/$ID.tar.gz" -C "$REPO" package.json package-lock.json src public scripts
cp "$REPO/deploy/remote-deploy.sh" "$SITE_HOME/$ID.sh"
chown "$SITE_USER:" "$SITE_HOME/$ID.env" "$SITE_HOME/$ID.tar.gz" "$SITE_HOME/$ID.sh"

su -s /bin/bash - "$SITE_USER" -c "bash ~/$ID.sh ~/$ID.env ~/$ID.tar.gz"
