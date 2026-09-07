#!/usr/bin/env sh
# TABBREW_CHROME launcher for the e2e suite: a throwaway profile with the
# harness loaded. Branded Google Chrome 137+ ignores --load-extension, so
# TABBREW_E2E_CHROME_BIN must be Chrome for Testing or Chromium.
set -eu
: "${TABBREW_E2E_CHROME_BIN:?}" "${TABBREW_E2E_PROFILE:?}" "${TABBREW_E2E_EXTENSION:?}"

# Ubuntu 24.04 blocks unprivileged user namespaces, which Chrome's sandbox needs.
case "$(uname -s)" in
  Linux) sandbox='--no-sandbox --disable-dev-shm-usage --disable-gpu' ;;
  *) sandbox='' ;;
esac

# The CLI ignores this process's output; keep it where CI can pick it up.
exec "$TABBREW_E2E_CHROME_BIN" \
  --user-data-dir="$TABBREW_E2E_PROFILE" \
  --no-first-run \
  --no-default-browser-check \
  --disable-sync \
  --disable-extensions-except="$TABBREW_E2E_EXTENSION" \
  --load-extension="$TABBREW_E2E_EXTENSION" \
  $sandbox \
  "$1" >"$TABBREW_E2E_PROFILE/launcher.log" 2>&1
