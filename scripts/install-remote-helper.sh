#!/usr/bin/env bash
set -euo pipefail

REPO="${CC_SWITCH_REPO:-xiaoY233/cc-switch-remote}"
VERSION="${1:-${CC_SWITCH_REMOTE_HELPER_RELEASE_TAG:-remote-helper-latest}}"
BIN_DIR="${CC_SWITCH_BIN_DIR:-$HOME/.local/bin}"
BIN_NAME="${CC_SWITCH_BIN_NAME:-cc-switch-remote-helper}"
OS="$(uname -s)"
ARCH="$(uname -m)"
mkdir -p "$BIN_DIR"

case "$OS" in
  Linux) ASSET_OS="Linux" ;;
  Darwin) ASSET_OS="macOS" ;;
  *) echo "Unsupported OS: $OS" >&2; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64) ASSET_ARCH="x86_64" ;;
  arm64|aarch64) ASSET_ARCH="arm64" ;;
  *) echo "Unsupported arch: $ARCH" >&2; exit 1 ;;
esac

API_URL="https://api.github.com/repos/$REPO/releases/tags/$VERSION"

ASSET_NAME="cc-switch-remote-helper-${VERSION}-${ASSET_OS}-${ASSET_ARCH}"
ASSET_NAME_PATTERN="(cc-switch-remote-helper|cc-switch-cli)-.*-${ASSET_OS}-${ASSET_ARCH}$"

DOWNLOAD_URL="$(
  curl -fsSL "$API_URL" |
    grep -E '"browser_download_url":' |
    sed -E 's/.*"browser_download_url": "([^"]+)".*/\1/' |
    grep -E "$ASSET_NAME_PATTERN" |
    tail -1
)"

if [ -z "$DOWNLOAD_URL" ]; then
  echo "No helper asset found for $ASSET_OS/$ASSET_ARCH from $API_URL" >&2
  exit 1
fi

curl -fsSL "$DOWNLOAD_URL" -o "$BIN_DIR/$BIN_NAME"
chmod +x "$BIN_DIR/$BIN_NAME"
if ! STATUS_OUTPUT="$("$BIN_DIR/$BIN_NAME" --json status 2>&1)"; then
  case "$STATUS_OUTPUT" in
    *libgdk-3.so.0*|*libgtk-3.so.0*|*libwebkit2gtk*|*libayatana-appindicator*)
      echo "Downloaded remote helper is not compatible with this server: it depends on desktop GTK/WebKit libraries. Reinstall after the latest helper release is published." >&2
      ;;
    *)
      echo "Remote helper downloaded but failed to start: $STATUS_OUTPUT" >&2
      ;;
  esac
  exit 1
fi
printf '%s\n' "$STATUS_OUTPUT"
