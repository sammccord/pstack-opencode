#!/usr/bin/env bash
# Symlink the vendored pstack skills, agents, and commands into your live opencode config.
#
# Non-destructive by default: an existing file that is not one of our symlinks is left in
# place and reported as a conflict. Re-running is safe (idempotent). Pass --force to replace
# conflicting entries (the originals are moved to <name>.pre-pstack.bak, never deleted).
#
#   bin/install.sh            # symlink, skip conflicts
#   bin/install.sh --force    # symlink, back up and replace conflicts
#   OPENCODE_CONFIG=/path bin/install.sh
#
# Uninstall with bin/uninstall.sh. The baked script paths in the skills assume the install
# target is ~/.config/opencode, so overriding OPENCODE_CONFIG elsewhere will break those
# helper-script references.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${OPENCODE_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

linked=0 already=0 conflicts=0
conflict_list=()

for kind in skills agent command; do
  src_dir="$REPO_ROOT/$kind"
  [ -d "$src_dir" ] || continue
  dest_dir="$CONFIG/$kind"
  mkdir -p "$dest_dir"
  for src in "$src_dir"/*; do
    [ -e "$src" ] || continue
    name="$(basename "$src")"
    dest="$dest_dir/$name"
    if [ -L "$dest" ]; then
      # Already a symlink. If it points back into this repo, it is ours: leave it.
      target="$(readlink "$dest")"
      case "$target" in
        "$REPO_ROOT"/*) already=$((already + 1)); continue ;;
      esac
      if [ "$FORCE" = 1 ]; then
        rm "$dest"; ln -s "$src" "$dest"; linked=$((linked + 1))
      else
        conflicts=$((conflicts + 1)); conflict_list+=("$kind/$name -> $target (foreign symlink)")
      fi
    elif [ -e "$dest" ]; then
      if [ "$FORCE" = 1 ]; then
        mv "$dest" "$dest.pre-pstack.bak"; ln -s "$src" "$dest"; linked=$((linked + 1))
      else
        conflicts=$((conflicts + 1)); conflict_list+=("$kind/$name (existing file)")
      fi
    else
      ln -s "$src" "$dest"; linked=$((linked + 1))
    fi
  done
done

echo "install: linked $linked, already-ours $already, conflicts $conflicts  ($CONFIG)"
if [ "$conflicts" -gt 0 ]; then
  printf '  conflict: %s\n' "${conflict_list[@]}"
  echo "  left untouched. Re-run with --force to back up and replace them."
  exit 1
fi
echo "done. Tab to the 'poteto' agent in opencode, or run /setup-pstack."
