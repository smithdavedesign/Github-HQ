#!/usr/bin/env bash
# One-time setup for the factory's morning email (Gmail SMTP via himalaya).
#
#   bash factory/bin/setup-email.sh you@gmail.com
#
# 1. Create a Gmail App Password (needs 2-Step Verification): https://myaccount.google.com/apppasswords
# 2. Run this script and paste it when asked. It goes into the login keychain
#    (service repohq-factory-gmail), never into a file; himalaya reads it at send time.
# 3. The script checks the SMTP login and sends today's report as a test.
set -euo pipefail

EMAIL="${1:-}"
HOME_DIR="${FACTORY_HOME:-$HOME/.repohq-factory}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
[ -n "$EMAIL" ] || { read -r -p "Gmail address: " EMAIL; }
[[ "$EMAIL" == *@* ]] || { echo "not an email address: $EMAIL" >&2; exit 2; }

read -r -s -p "Gmail App Password for $EMAIL (input hidden): " PW; echo
PW="${PW// /}"   # Google shows it in groups of four
[ ${#PW} -ge 16 ] || { echo "that doesn't look like a 16-character app password" >&2; exit 2; }
security add-generic-password -U -s repohq-factory-gmail -a "$EMAIL" -w "$PW"
unset PW
echo "stored in login keychain (service repohq-factory-gmail)"

mkdir -p "$HOME_DIR"
cat > "$HOME_DIR/himalaya.toml" <<TOML
# RepoHQ factory morning email — written by factory/bin/setup-email.sh
[accounts.factory]
default = true
email = "$EMAIL"
display-name = "RepoHQ Factory"
message.send.save-copy = false
message.send.backend.type = "smtp"
message.send.backend.host = "smtp.gmail.com"
message.send.backend.port = 465
message.send.backend.encryption.type = "tls"
message.send.backend.login = "$EMAIL"
message.send.backend.auth.type = "password"
message.send.backend.auth.cmd = "security find-generic-password -s repohq-factory-gmail -a $EMAIL -w"
TOML
chmod 600 "$HOME_DIR/himalaya.toml"

touch "$HOME_DIR/env"
grep -q '^FACTORY_REPORT_EMAIL=' "$HOME_DIR/env" \
  && sed -i '' "s|^FACTORY_REPORT_EMAIL=.*|FACTORY_REPORT_EMAIL=$EMAIL|" "$HOME_DIR/env" \
  || printf '\n# Morning report recipient (himalaya config: %s/himalaya.toml)\nFACTORY_REPORT_EMAIL=%s\n' "$HOME_DIR" "$EMAIL" >> "$HOME_DIR/env"

echo "checking SMTP login…"
himalaya -c "$HOME_DIR/himalaya.toml" account doctor factory >/dev/null 2>&1 \
  || { echo "SMTP login failed — check the app password (and that 2-Step Verification is on)" >&2; exit 1; }

echo "sending today's report as a test…"
cd "$ROOT" && FACTORY_REPORT_EMAIL="$EMAIL" npx --no-install tsx factory/report.ts
