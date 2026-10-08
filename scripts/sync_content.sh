#!/bin/bash
# Push locally-curated prompts/dares/truths onto staging or prod.
# Merges by text (see apply_content.py) — never deletes, so it's safe even
# if you also edit content directly on the target's admin panel.
#
# Pass --replace as a third arg to make the target match local exactly,
# removing anything there that isn't in the local set too (skips anything
# still referenced by game history, same as the admin panel would).
#
# Usage: scripts/sync_content.sh staging|prod [--replace]
set -e

TARGET="$1"
REPLACE_FLAG="$2"
if [ "$TARGET" != "staging" ] && [ "$TARGET" != "prod" ]; then
  echo "usage: $0 staging|prod [--replace]" >&2
  exit 1
fi

HOST="vecherinka@45.144.232.83"
if [ "$TARGET" = "staging" ]; then
  REMOTE_DIR="/home/vecherinka/staging-app"
else
  REMOTE_DIR="/home/vecherinka/app"
fi

cd "$(dirname "$0")/.."

DUMP=$(mktemp /tmp/vecherinka-content-XXXXXX.json)
python3 scripts/dump_content.py > "$DUMP"

echo "Copying any new uploaded audio files (never overwrites existing ones)..."
rsync -az --ignore-existing -e ssh uploads/ "$HOST:$REMOTE_DIR/uploads/"

echo "Uploading content dump..."
scp -q "$DUMP" "$HOST:$REMOTE_DIR/content_dump.json"

echo "Applying on $TARGET${REPLACE_FLAG:+ (full replace)}..."
ssh "$HOST" "cd $REMOTE_DIR && ./venv/bin/python scripts/apply_content.py content_dump.json $REPLACE_FLAG && rm content_dump.json"

rm "$DUMP"
echo "Done."
