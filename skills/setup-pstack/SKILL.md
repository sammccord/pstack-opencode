---
name: setup-pstack
description: Configure which models pstack uses per role. Detects your available models and rewrites the pstack subagent definitions. Use for /setup-pstack, "configure pstack models", or changing pstack's model choices.
---

# Setup pstack

pstack picks a model per role. In Cursor that was a `model` parameter on every subagent
call, backed by an always-applied rule file. opencode has no such parameter. A subagent's
model is fixed by its agent definition, so the role table lives in agent files instead.

Your job is to edit one manifest and regenerate those agent files.

- Manifest: `~/.config/opencode/pstack-sync/models.json`
- Generated: `~/.config/opencode/agent/pstack-*.md`, `poteto.md`, `comment-sicko.md`

Never hand-edit the generated agent files. Every sync overwrites them.

## Roles

Four roles, four models. Panels spawn one subagent per role, which is where model diversity
comes from. Each role also has a read-only variant with the same model and `edit: deny`,
used by every review and investigation path.

| Role | Agents | Used for |
|------|--------|----------|
| `fast` | `pstack-fast`, `pstack-fast-read` | mechanical edits, swarm workers, code exploration |
| `precise` | `pstack-precise`, `pstack-precise-read` | precisely specified step sequences |
| `judgment` | `pstack-judgment`, `pstack-judgment-read` | hardest changes, prose, synthesis |
| `opus` | `pstack-opus`, `pstack-opus-read` | fourth panel member |

Two more agents are not role-backed. `poteto-agent` deliberately omits `model` so it runs on
the parent chat model, which is pstack's `inherit-parent` behavior and how Auto users stay on
Auto. `poteto` is the sticky primary agent and takes the chat model you want to live in.

## Steps

### 1. Detect available models

Run `opencode models`. That is the dependable source. If it fails, ask the user to paste the
model IDs they have access to. Never write a model ID you have not confirmed exists; an agent
pointing at a missing model fails at spawn time, not at load time, so the breakage surfaces
mid-task.

### 2. Load current state

Read `~/.config/opencode/pstack-sync/models.json`. Its `roles` map is the current
assignment. Treat it as the starting point.

### 3. Map and confirm

Show every role with its current model and purpose. Mark any model not in the detected set as
needing a choice. Then ask whether to accept as-is or change specific roles, offering the
detected models as options. Use the `question` tool rather than free text.

Two properties matter more than any individual pick.

- **The four role models should be genuinely different**, and ideally from different
  families. Panels exist to surface disagreement. Four roles on one model gives you one
  opinion four times, which reads as consensus and is not.
- **`fast` should actually be fast.** It carries swarm fan-out and mechanical edits, where
  latency multiplies by N.

### 4. Validate

Every model written must be in the detected set. If a chosen one is not available, stop and
ask again.

### 5. Write and regenerate

Write the chosen values into the `roles` map in `models.json`, preserving the `purpose`
strings. Then regenerate:

```
cd ~/.config/opencode/pstack-sync && bun run sync.ts
```

That rewrites every `agent/pstack-*.md` from the manifest and runs the validator. A non-zero
exit means the generated config is broken; report the failure instead of declaring success.

### 6. Confirm

Show the user the final role table and tell them new sessions pick it up. Confirm the
validator passed. Re-running this skill updates the mapping.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or
an existing harness). If not, offer once: "want a project-local verification skill, so agents
can drive the app the way a user does and prove changes work? I can generate one with
/create-verification-skill." On yes, invoke `/create-verification-skill`. On no, move on
without pushing.
