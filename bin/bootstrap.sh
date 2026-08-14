#!/usr/bin/env bash
# Fetch the pinned upstream pstack source into .cache/pstack-src.
#
# Only needed to RE-SYNC (regenerate the vendored outputs from upstream). Installing the
# already-vendored skills/agents/commands does not require this — see bin/install.sh.
#
# Uses a blobless partial clone + sparse checkout so we pull only the pstack subdir at one
# commit, not the whole cursor/plugins monorepo history.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIN="$REPO_ROOT/sync/pstack.pin"
CACHE="$REPO_ROOT/.cache/pstack-src"

command -v git >/dev/null || { echo "bootstrap: git not found" >&2; exit 1; }
command -v jq  >/dev/null || { echo "bootstrap: jq not found (brew install jq)" >&2; exit 1; }

REMOTE="$(jq -r .remote "$PIN")"
COMMIT="$(jq -r .commit "$PIN")"
SUBDIR="$(jq -r .subdir "$PIN")"

echo "bootstrap: $REMOTE @ ${COMMIT:0:12} (subdir: $SUBDIR)"

if [ ! -d "$CACHE/.git" ]; then
  rm -rf "$CACHE"
  git clone --filter=blob:none --no-checkout "$REMOTE" "$CACHE"
fi

git -C "$CACHE" sparse-checkout set --cone "$SUBDIR"
git -C "$CACHE" fetch --filter=blob:none origin "$COMMIT"
git -C "$CACHE" checkout --detach "$COMMIT"

test -d "$CACHE/$SUBDIR/skills" || { echo "bootstrap: expected $CACHE/$SUBDIR/skills after checkout" >&2; exit 1; }
echo "bootstrap: ready. PSTACK_SRC=$CACHE/$SUBDIR"
echo "next: bun run sync"
