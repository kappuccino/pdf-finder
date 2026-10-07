#!/usr/bin/env bash
# Auto-test de l'app en mode dev sur un dossier de PDF :
#   packages/app/scripts/selftest.sh "/chemin/vers/pdfs" "REF1,REF2,…"
# Le dossier est autorisé via une capability temporaire (overlay de config, jamais dans le build).
set -euo pipefail
DIR=$(cd "$1" && pwd)
cd "$(dirname "$0")/.."
OVERLAY=$(mktemp -t pdfref-selftest).json
cat > "$OVERLAY" <<JSON
{ "app": { "security": { "capabilities": ["default", {
  "identifier": "selftest", "windows": ["main"],
  "permissions": [{ "identifier": "fs:scope", "allow": [{ "path": "$DIR" }, { "path": "$DIR/**" }] }]
} ] } } }
JSON
export PATH="$HOME/.cargo/bin:$PATH" VITE_SELFTEST_DIR="$DIR" VITE_SELFTEST_REFS="${2:-}"
npx tauri dev --config "$OVERLAY"
