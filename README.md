# pstack-opencode

The [pstack](https://github.com/cursor/plugins/tree/main/pstack) Cursor plugin, ported to
[opencode](https://opencode.ai): its 44 skills, a model-diverse set of subagents, a sticky
`poteto` primary agent, and slash-command wrappers. A re-runnable pipeline does the
translation, so a new pstack release can be pulled in without redoing it by hand.

The generated files are committed (`skills/`, `agent/`, `command/`), so a fresh clone works
without running anything. `install` just symlinks them into your opencode config.

## Install

```sh
git clone https://github.com/sammccord/pstack-opencode ~/work/pstack-opencode
cd ~/work/pstack-opencode
bin/install.sh
```

That symlinks `skills/`, `agent/`, and `command/` into `~/.config/opencode/`. It is
non-destructive: any file of yours that would collide is left in place and reported, and the
command exits non-zero. Re-running is a no-op. `bin/install.sh --force` backs up colliding
files to `<name>.pre-pstack.bak` and replaces them.

Then, in opencode, run `/setup-pstack` and Tab to the **poteto** agent.

> Install target must be `~/.config/opencode`. The skills reference their helper scripts by
> absolute path (`~/.config/opencode/skills/...`), so pointing `OPENCODE_CONFIG` elsewhere
> installs cleanly but breaks those references.

## Uninstall

```sh
bin/uninstall.sh
```

Removes only the symlinks that point back into this repo — your own config is untouched — and
restores any `.pre-pstack.bak` a `--force` install set aside.

## Update to a newer pstack

```sh
$EDITOR sync/pstack.pin      # bump "commit" to the upstream you want
bin/bootstrap.sh             # pinned partial-clone of cursor/plugins into .cache/
bun run sync                 # regenerate skills/ agent/ command/, then validate
git add -A && git commit     # review the diff, commit the new vendored outputs
```

`bin/bootstrap.sh` and `bun run sync` are needed **only to re-sync**. Installing the
already-vendored outputs needs neither.

## What the port had to change

opencode's `task` tool takes only `description`, `prompt`, `subagent_type`, `task_id`. pstack
chooses a model per role by passing `model` on every Cursor `Task` call and sandboxes
reviewers with `readonly`. Neither knob exists per-call in opencode, so both move into the
agent definition, turning the role table into named subagents:

| Role | Write agent | Read-only agent | Model |
|---|---|---|---|
| fast | `pstack-fast` | `pstack-fast-read` | `claude-sonnet-5` |
| precise | `pstack-precise` | `pstack-precise-read` | `gpt-5.6-sol` |
| judgment | `pstack-judgment` | `pstack-judgment-read` | `claude-fable-5` |
| opus | `pstack-opus` | `pstack-opus-read` | `claude-opus-5` |

`-read` variants set `permission.edit: deny`. A review panel spawns one subagent per role —
that is the only reason it produces disagreement rather than four copies of one opinion.
Change the mapping with `/setup-pstack`, or edit `sync/models.json` and re-sync. The
`agent/pstack-*.md` files are generated; never hand-edit them.

## Layout

```
skills/     44 vendored skills (23 workflow + 21 principle-*)   } generated,
agent/      11 agents (poteto, poteto-agent, comment-sicko, 8 pstack-*) } committed,
command/    23 slash-command wrappers (one per workflow skill)  } symlinked by install
sync/       the translation pipeline (see sync/README.md)
bin/        bootstrap.sh · install.sh · uninstall.sh
```

`sync/README.md` documents the pipeline internals: the copy → patch → rewrite → overlay →
generate → validate stages, and how to add a translation rule.

## Degraded features

pstack's unattended-autonomy skills (`swarm`, `orchestrate`, `autopilot-full`,
`autopilot-stack`, `autonomous-run`) run on Cursor cloud agents — separate checkouts polled
and re-armed by a wake chain. opencode awaits local subagents against one working tree, so
each of those skills carries an explicit degradation note rather than promising concurrency
it cannot deliver. Transcript-mining skills read `~/.local/share/opencode/storage/` via
`skills/poteto-mode/scripts/session-digest.ts`, scoped to the current project.

## Requirements

- [Bun](https://bun.sh) (pipeline is TypeScript run under Bun)
- `git`, `jq` (bootstrap)
- opencode on PATH, or the `cbcode`-bundled build, for the sync's binary validation step
  (skipped with a note if absent)
