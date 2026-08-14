#!/usr/bin/env bash
# Remove the symlinks that bin/install.sh created. Only removes links that point back into
# this repo, so anything you added to ~/.config/opencode yourself is never touched. Restores
# any <name>.pre-pstack.bak that --force set aside.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${OPENCODE_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"

removed=0 restored=0
for kind in skills agent command; do
  dest_dir="$CONFIG/$kind"
  [ -d "$dest_dir" ] || continue
  for dest in "$dest_dir"/*; do
    [ -L "$dest" ] || continue
    target="$(readlink "$dest")"
    case "$target" in
      "$REPO_ROOT"/*)
        rm "$dest"; removed=$((removed + 1))
        if [ -e "$dest.pre-pstack.bak" ]; then
          mv "$dest.pre-pstack.bak" "$dest"; restored=$((restored + 1))
        fi
        ;;
    esac
  done
done

echo "uninstall: removed $removed symlink(s), restored $restored backup(s)  ($CONFIG)"
