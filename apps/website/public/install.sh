#!/bin/bash
# Rippopotamus installer for macOS (Apple Silicon).
#
#   curl -fsSL https://rippopotamus.vercel.app/install.sh | bash
#
# Piped through curl, this script is never quarantined, so it can install the
# app AND clear Gatekeeper's quarantine flag -- the unsigned build then opens
# normally instead of showing "Rippopotamus is damaged and can't be opened."
#
# ASCII-only output on purpose: macOS ships bash 3.2, where a UTF-8 char placed
# immediately after "$VAR" gets swallowed into the variable name.
set -euo pipefail

REPO="Hellodebasishsahu/Rippopotamus"
DL_BASE="https://github.com/${REPO}/releases/latest/download"
ASSET="Rippopotamus-mac-arm64.dmg"
APP="Rippopotamus.app"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This installer is for macOS. See https://rippopotamus.vercel.app for other platforms." >&2
  exit 1
fi
if [ "$(uname -m)" != "arm64" ]; then
  echo "Rippopotamus currently ships an Apple Silicon (arm64) build only; Intel isn't supported yet." >&2
  exit 1
fi

# Install per-user if /Applications isn't writable (no admin needed).
DEST="/Applications"
if [ ! -w "${DEST}" ]; then
  DEST="${HOME}/Applications"
  mkdir -p "${DEST}"
  echo "Note: /Applications is not writable; installing to ${DEST} instead."
fi

TMP="$(mktemp -d)"
MNT=""
cleanup() {
  if [ -n "${MNT}" ]; then hdiutil detach "${MNT}" -quiet 2>/dev/null || true; fi
  rm -rf "${TMP}"
}
trap cleanup EXIT

echo "-> Downloading the latest Rippopotamus..."
curl -fL --retry 3 --retry-delay 2 "${DL_BASE}/${ASSET}" -o "${TMP}/${ASSET}"

echo "-> Verifying checksum..."
curl -fsSL --retry 3 "${DL_BASE}/SHA256SUMS" -o "${TMP}/SHA256SUMS"
(cd "${TMP}" && grep " ${ASSET}\$" SHA256SUMS | shasum -a 256 -c -) || {
  echo "Checksum verification FAILED. The download may be corrupt or tampered with. Aborting." >&2
  exit 1
}

# Detach any leftover Rippopotamus volume so we mount at a predictable path.
for vol in /Volumes/Rippopotamus*; do
  [ -d "${vol}" ] && hdiutil detach "${vol}" -force 2>/dev/null || true
done

echo "-> Mounting the disk image..."
MNT="$(hdiutil attach "${TMP}/${ASSET}" -nobrowse -noautoopen | grep -Eo '/Volumes/.*' | tail -1)"
if [ -z "${MNT}" ] || [ ! -d "${MNT}/${APP}" ]; then
  echo "Could not find ${APP} in the downloaded image." >&2
  exit 1
fi

echo "-> Installing to ${DEST} ..."
rm -rf "${DEST}/${APP}"
cp -R "${MNT}/${APP}" "${DEST}/"

echo "-> Clearing Gatekeeper quarantine..."
xattr -dr com.apple.quarantine "${DEST}/${APP}" 2>/dev/null || true

echo "Installed. Opening Rippopotamus now."
open "${DEST}/${APP}"
