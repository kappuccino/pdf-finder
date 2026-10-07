#!/usr/bin/env bash
# Build macOS signé.
#  - Sans certificat : signature ad-hoc (tauri.conf.json → signingIdentity "-"), OK pour ce Mac.
#  - Avec un certificat "Developer ID Application" dans le trousseau : signature + notarisation Apple,
#    plus aucun avertissement Gatekeeper sur les autres Mac.
#
# Variables (dans l'environnement ou dans packages/app/.env.signing, non versionné) :
#   APPLE_SIGNING_IDENTITY="Developer ID Application: Nom (TEAMID)"
#   Notarisation, au choix :
#     APPLE_ID="vous@exemple.com"  APPLE_PASSWORD="mot de passe d'app"  APPLE_TEAM_ID="TEAMID"
#   ou (clé API App Store Connect) :
#     APPLE_API_ISSUER="…"  APPLE_API_KEY="…"  APPLE_API_KEY_PATH="/chemin/AuthKey_XXXX.p8"
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env.signing ] && set -a && . ./.env.signing && set +a
export PATH="$HOME/.cargo/bin:$PATH"

if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
  echo "Signature : $APPLE_SIGNING_IDENTITY"
  if [ -n "${APPLE_ID:-}${APPLE_API_KEY:-}" ]; then echo "Notarisation : activée"; else echo "Notarisation : désactivée (identifiants absents)"; fi
else
  echo "Signature : ad-hoc (aucun APPLE_SIGNING_IDENTITY)"
fi

TARGET="${1:-}"   # ex. universal-apple-darwin
if [ -n "$TARGET" ]; then npx tauri build --target "$TARGET"; else npx tauri build; fi

APP=$(ls -d src-tauri/target/${TARGET:+$TARGET/}release/bundle/macos/*.app | head -1)
echo; codesign -dv --verbose=2 "$APP" 2>&1 | grep -E "Authority|Signature|TeamIdentifier|flags" || true
spctl -a -vv "$APP" 2>&1 || echo "(Gatekeeper refuse les apps non notarisées : normal en ad-hoc)"
