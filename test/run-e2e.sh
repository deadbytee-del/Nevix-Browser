#!/bin/sh
# Runs the end-to-end suite in a throwaway profile under Xvfb. Needs root (binds :80) and ImageMagick `import` for screenshots (optional).
set -e
cd "$(dirname "$0")/.."
PROFILE=$(mktemp -d)
export NEVIX_E2E=1
export NEVIX_OUT="${NEVIX_OUT:-$PROFILE}"
for v in HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy; do unset $v; done
exec xvfb-run -a -s "-screen 0 1400x900x24" npx electron . --no-sandbox --disable-gpu --user-data-dir="$PROFILE" \
  --host-resolver-rules="MAP *.test 127.0.0.1, MAP doubleclick.net 127.0.0.1, MAP www.google-analytics.com 127.0.0.1" \
  --nevix-e2e ${NEVIX_TEST:-test/e2e.js}
