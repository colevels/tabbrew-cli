#!/bin/sh
# tabbrew-cli installer — downloads the latest release binary for your platform.
#
#   curl -fsSL https://raw.githubusercontent.com/colevels/tabbrew-cli/main/install.sh | sh
#
# Override the install location with TABBREW_INSTALL_DIR (default: ~/.local/bin).
set -eu

REPO="colevels/tabbrew-cli"
BIN="tabbrew"
INSTALL_DIR="${TABBREW_INSTALL_DIR:-$HOME/.local/bin}"
BASE_URL="https://github.com/${REPO}/releases/latest/download"

info() { printf '%s\n' "$*"; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

# --- detect platform ---
os=$(uname -s)
arch=$(uname -m)
case "$os" in
  Darwin) os_name="darwin" ;;
  Linux)  os_name="linux" ;;
  *) die "unsupported OS: $os (prebuilt binaries exist for macOS and Linux only)" ;;
esac
case "$arch" in
  arm64|aarch64) arch_name="arm64" ;;
  x86_64|amd64)  arch_name="x64" ;;
  *) die "unsupported architecture: $arch" ;;
esac

asset="${BIN}-${os_name}-${arch_name}"
info "Installing ${BIN} for ${os_name}-${arch_name}…"

command -v curl >/dev/null 2>&1 || die "curl is required but was not found"

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

# --- download the binary ---
curl -fSL --progress-bar "${BASE_URL}/${asset}" -o "${tmpdir}/${BIN}" \
  || die "download failed: ${BASE_URL}/${asset}"

# --- verify checksum (best-effort; skipped if no sha tool is available) ---
if curl -fsSL "${BASE_URL}/checksums.txt" -o "${tmpdir}/checksums.txt" 2>/dev/null; then
  if command -v sha256sum >/dev/null 2>&1; then sha="sha256sum";
  elif command -v shasum   >/dev/null 2>&1; then sha="shasum -a 256";
  else sha=""; fi
  if [ -n "$sha" ]; then
    expected=$(grep " ${asset}$" "${tmpdir}/checksums.txt" | awk '{print $1}')
    actual=$($sha "${tmpdir}/${BIN}" | awk '{print $1}')
    if [ -n "$expected" ] && [ "$expected" != "$actual" ]; then
      die "checksum mismatch for ${asset} (expected ${expected}, got ${actual})"
    fi
    [ -n "$expected" ] && info "Checksum verified."
  fi
fi

# --- install ---
chmod +x "${tmpdir}/${BIN}"
mkdir -p "$INSTALL_DIR"
mv "${tmpdir}/${BIN}" "${INSTALL_DIR}/${BIN}"
info "Installed ${BIN} to ${INSTALL_DIR}/${BIN}"

# --- PATH check ---
case ":${PATH}:" in
  *":${INSTALL_DIR}:"*)
    info ""
    info "Done — run: ${BIN} --help"
    ;;
  *)
    info ""
    info "${INSTALL_DIR} is not on your PATH yet. Add it:"
    info "  echo 'export PATH=\"${INSTALL_DIR}:\$PATH\"' >> ~/.zshrc && . ~/.zshrc"
    info "Then run: ${BIN} --help"
    ;;
esac
