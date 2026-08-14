# pstack-sync

Ports the [pstack](https://github.com/cursor/plugins/tree/main/pstack) Cursor plugin into
this opencode config. Re-runnable, so upstream pstack releases can be pulled in without
re-doing the translation by hand.

```
bun run sync.ts              # transform, generate, validate
bun run sync.ts --dry-run    # report what would change, write nothing
bun run validate.ts          # re-check an existing install
```

## What it produces

| Output | Count | Notes |
|---|---|---|
| `../skills/<name>/SKILL.md` | 44 | 23 workflow skills, 21 `principle-*` |
| `../agent/*.md` | 11 | 8 `pstack-*`, `poteto`, `poteto-agent`, `comment-sicko` |
| `../command/*.md` | 23 | one per workflow skill, principles excluded |

`pstack-lock.json` records the upstream version and a hash per generated file. A clean re-run
changes nothing in it.

## The problem this exists to solve

pstack chooses a model per role by passing `model` on every Cursor `Task` call, and sandboxes
reviewers with `readonly`. opencode's `task` tool takes only `description`, `prompt`,
`subagent_type`, `task_id`. Both knobs move into the agent definition instead, so the whole
role table becomes named subagents:

| Role | Write agent | Read agent | Model |
|---|---|---|---|
| fast | `pstack-fast` | `pstack-fast-read` | `claude-sonnet-5` |
| precise | `pstack-precise` | `pstack-precise-read` | `gpt-5.6-sol` |
| judgment | `pstack-judgment` | `pstack-judgment-read` | `claude-fable-5` |
| opus | `pstack-opus` | `pstack-opus-read` | `claude-opus-5` |

`-read` variants set `permission.edit: deny` and keep MCP access. Panels spawn one subagent
per role, which is the only reason the panels produce disagreement rather than four copies of
one opinion.

Change models via `/setup-pstack`, or edit `models.json` and re-run. Never hand-edit
`../agent/pstack-*.md`; every sync overwrites them.

## Pipeline

1. **Copy** `skills/` from source. `automations/` (Cursor `/automate`), `docs/`, and the
   plugin manifest are dropped. Executable bits preserved.
2. **Patch** (`patches.ts`) against *pristine* upstream text. Restructures, not
   substitutions: the delegation blocks where model choice and sandboxing changed shape.
   Output is sentinel-guarded so step 3 leaves it alone.
3. **Rewrite** (`rewrites.tsv`) regex substitutions, applied in file order. Longest phrase
   first, since a short rule firing early leaves mangled grammar for the long rule to miss.
4. **Overlay** whole-file replacements for content where almost nothing upstream survives.
5. **Normalize frontmatter** to opencode's five recognized fields, forcing `name` to the
   directory name.
6. **Generate** agents from `models.json` and commands from the skill list.
7. **Validate**, then write the lock.

### Adding a translation

Prefer a rule in `rewrites.tsv`. Use `patches.ts` when the surrounding prose has to change
shape. Use `overlay/` only when the file is effectively rewritten (currently
`setup-pstack/SKILL.md`, whose entire mechanism was writing a Cursor `.mdc` rule file).

A patch anchor that stops matching exactly once **fails the sync**. That is deliberate. A
silently skipped patch ships a skill instructing the agent to pass a `model` parameter that
does not exist, and nothing downstream would notice.

## Notes for the next person

Two findings that cost real time here.

**Validate against the binary that actually runs.** `~/.opencode/bin/opencode` is a stale
1.0.107 install. The live runtime is the one `cbcode` bundles (1.18.16). They disagree on
which config keys exist and on whether `hidden` may be a string, so the stale one produced two
confidently wrong conclusions. `validate.ts` resolves the live binary and asks it to parse the
generated agents, because no static check catches this class: an unquoted `#e8b923` for
`color` is a YAML comment, and `color: warning` is a documented value this build rejects.

**The published docs are wrong about directory names.** opencode reads `agent/` and
`command/`, both singular, and hard-errors on the plural forms.

## Degraded features

pstack's unattended-autonomy story runs on Cursor cloud agents: separate checkouts, polled
rather than awaited, re-armed by a wake chain. opencode has none of that. `swarm`,
`orchestrate`, `autopilot-full`, `autopilot-stack`, and `autonomous-run` each carry an
explicit degradation note rather than silently promising concurrency they cannot deliver.

Transcript mining (`recall`, `reflect`, `eval`, `show-me-your-work`, `automate-me`) relied on
Cursor naming a per-workspace transcript directory in the system prompt. Replaced with
`../skills/poteto-mode/scripts/session-digest.ts`, which reads
`~/.local/share/opencode/storage/` and scopes to the current project by filtering on each
session's recorded directory. That filter is the privacy boundary; `--all-projects` reads
unrelated private chats.
