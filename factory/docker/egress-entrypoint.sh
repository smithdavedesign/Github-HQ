#!/bin/sh
# Writes the tinyproxy allowlist from EGRESS_ALLOW_HOSTS (space-separated hostnames), then runs
# the model relay and the proxy. Hosts not on the list are refused by tinyproxy.
set -eu
: "${EGRESS_ALLOW_HOSTS:?EGRESS_ALLOW_HOSTS is required}"
# Set, but may be empty: no model calls at all, and the relay refuses every one. An idea growth build
# runs on the subscription with no free-pool fallback, so it opens the sandbox with no models; when
# this required a model, its egress exited at once and the build failed (tiebreak, 2026-10-12).
: "${EGRESS_ALLOW_MODELS?EGRESS_ALLOW_MODELS is required (empty means no models)}"

: > /etc/tinyproxy/filter
for h in $EGRESS_ALLOW_HOSTS; do
  printf '^%s$\n' "$(printf '%s' "$h" | sed 's/[.]/\\./g')" >> /etc/tinyproxy/filter
done

cat > /etc/tinyproxy/tinyproxy.conf <<CONF
User nobody
Group nobody
Port 8888
Listen 0.0.0.0
Timeout 600
MaxClients 64
LogLevel Notice
Filter "/etc/tinyproxy/filter"
FilterType ere
FilterURLs Off
FilterDefaultDeny Yes
ConnectPort 443
DisableViaHeader Yes
CONF

# Both drop root: the relay runs as the image's `node` user, tinyproxy switches to nobody after binding.
su-exec node node /opt/egress/egress-relay.mjs &
exec tinyproxy -d -c /etc/tinyproxy/tinyproxy.conf
