#!/bin/sh
# tabbrew-cli installer: downloads the latest release binary for this machine.
#
#   curl -fsSL https://raw.githubusercontent.com/colevels/tabbrew-cli/main/install.sh | sh
#
# TABBREW_INSTALL_DIR overrides the install location (default: ~/.local/bin).
set -eu

REPO="colevels/tabbrew-cli"
BIN="tabbrew"
INSTALL_DIR="${TABBREW_INSTALL_DIR:-$HOME/.local/bin}"
BASE_URL="https://github.com/${REPO}/releases/latest/download"

info() { printf '%s\n' "$*"; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

os=$(uname -s)
arch=$(uname -m)
case "$os" in
  Darwin) os_name="darwin" ;;
  Linux)  os_name="linux" ;;
  *) die "unsupported OS: $os (prebuilt binaries exist for macOS and Linux; on other systems use: npm install -g tabbrew-cli)" ;;
esac
case "$arch" in
  arm64|aarch64) arch_name="arm64" ;;
  x86_64|amd64)  arch_name="x64" ;;
  *) die "unsupported architecture: $arch" ;;
esac

asset="${BIN}-${os_name}-${arch_name}"
info "Installing ${BIN} for ${os_name}-${arch_name}..."

command -v curl >/dev/null 2>&1 || die "curl is required but was not found"

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

curl -fSL --progress-bar "${BASE_URL}/${asset}" -o "${tmpdir}/${BIN}" \
  || die "download failed: ${BASE_URL}/${asset}"

# Best effort: skipped when no sha tool is available.
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

chmod +x "${tmpdir}/${BIN}"
mkdir -p "$INSTALL_DIR"
mv "${tmpdir}/${BIN}" "${INSTALL_DIR}/${BIN}"
info "Installed ${BIN} $("${INSTALL_DIR}/${BIN}" --version) to ${INSTALL_DIR}/${BIN}"

case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) ;;
  *)
    info ""
    info "${INSTALL_DIR} is not on your PATH yet. Add it:"
    info "  echo 'export PATH=\"${INSTALL_DIR}:\$PATH\"' >> ~/.zshrc && . ~/.zshrc"
    ;;
esac

info ""
info "Next, load the matching extension in Chrome (once per version):"
info "  1. Download ${BASE_URL}/tabbrew-extension.zip and unzip it"
info "  2. chrome://extensions -> Developer mode -> Load unpacked -> the unzipped folder"
info "Then: ${BIN} session start"
