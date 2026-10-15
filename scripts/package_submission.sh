#!/usr/bin/env bash
#
# Builds the Moodle submission archive and refuses to produce one that
# would be rejected. Run from the repository root:
#
#     bash scripts/package_submission.sh
#
# Produces ../24_a1b.zip, outside the repo so it is never committed.

set -euo pipefail

TEAM="24"
NAME="${TEAM}_a1b"
OUT="${1:-../${NAME}.zip}"
LIMIT_MB=20

cd "$(dirname "$0")/.."

echo "Packaging ${NAME}..."

rm -f "$OUT"

# -x patterns exclude the things the brief explicitly forbids.
zip -qr "$OUT" . \
  -x '*/node_modules/*' \
  -x 'node_modules/*' \
  -x '*/.venv/*' -x '.venv/*' \
  -x '*/venv/*' -x 'venv/*' \
  -x '*/__pycache__/*' -x '__pycache__/*' \
  -x '*/dist/*' -x 'dist/*' \
  -x '.git/*' \
  -x '*.zip' \
  -x '.DS_Store' -x '*/.DS_Store' \
  -x '*.pyc'

SIZE_BYTES=$(wc -c < "$OUT" | tr -d ' ')
SIZE_MB=$(echo "scale=2; $SIZE_BYTES / 1048576" | bc)

echo
echo "Archive:  $(cd .. && pwd)/${NAME}.zip"
echo "Size:     ${SIZE_MB} MB (limit ${LIMIT_MB} MB)"
echo "Files:    $(unzip -l "$OUT" | tail -1 | awk '{print $2}')"
echo

# Fail loudly rather than letting a bad archive reach Moodle.
FORBIDDEN=$(unzip -l "$OUT" | grep -E 'node_modules|__pycache__|/dist/|\.venv/' || true)
if [ -n "$FORBIDDEN" ]; then
  echo "REFUSING: archive contains forbidden paths:"
  echo "$FORBIDDEN" | head -5
  rm -f "$OUT"
  exit 1
fi

if [ "$SIZE_BYTES" -gt $((LIMIT_MB * 1048576)) ]; then
  echo "REFUSING: archive is over the ${LIMIT_MB} MB limit."
  rm -f "$OUT"
  exit 1
fi

echo "Clean. Contents:"
unzip -l "$OUT" | awk 'NR>3 && NF==4 {print $4}' | awk -F/ '{print $1}' | sort -u | sed 's/^/  /'
echo
echo "Ready to upload."
