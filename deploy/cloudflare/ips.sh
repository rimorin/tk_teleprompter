#!/usr/bin/env sh
# Prints Cloudflare's current edge IP ranges in the formats this app's settings expect.
# Cloudflare publishes them at https://www.cloudflare.com/ips/ (they change rarely).
set -eu
ranges=$(curl -fsS https://www.cloudflare.com/ips-v4; echo; curl -fsS https://www.cloudflare.com/ips-v6)
ranges=$(printf '%s\n' "$ranges" | grep -v '^$')

echo "# web service (Caddy): space-separated"
echo "TRUSTED_PROXIES=private_ranges $(printf '%s\n' "$ranges" | paste -sd' ' -)"
echo
echo "# api service when Cloudflare connects to it directly: comma-separated"
echo "TRUST_PROXY=$(printf '%s\n' "$ranges" | paste -sd, -)"
