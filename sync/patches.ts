/**
 * Semantic patches applied to pstack's markdown after rewrites.tsv and before overlay.
 *
 * rewrites.tsv handles substitutions. These are restructures: Cursor expressed model choice
 * and sandboxing as parameters on a Task call, and opencode expresses both as which subagent
 * you pick, so the surrounding prose has to change shape rather than swap a token.
 *
 * Every patch asserts its `old` appears exactly once in the file. When an upstream pstack
 * release rewords one of these passages the sync fails loudly here, which is the point: a
 * silently skipped patch would ship a skill telling the agent to pass a `model` parameter
 * that does not exist.
 *
 * Whole-file replacements live in overlay/ instead. Use those when almost nothing survives.
 */

export type Patch = { old: string; new: string; why?: string }

export const PATCHES: Record<string, Patch[]> = {
  "how/SKILL.md": [
    {
      why: "how: explorers, explainer, critics",
      old: `Spawn all explorers in a single message:

- \`subagent_type\`: \`generalPurpose\`
- \`model\`: your configured how-explorer model (default \`grok-4.6-fast-xhigh\`)
- \`readonly\`: \`true\`

`,
      new: `Spawn all explorers in a single message with \`subagent_type: pstack-fast-read\`.

That agent pins the fast code model and cannot write. Model choice in opencode is which
subagent you pick, not a \`task\` parameter. Run \`/setup-pstack\` to change which model backs
the role.
`,
    },
    {
      old: `Spawn a single Task subagent that explores and explains in one pass:

- \`subagent_type\`: \`generalPurpose\`
- \`model\`: your configured how-explainer model (default \`claude-fable-5-thinking-max\`)
- \`readonly\`: \`true\`
`,
      new: `Spawn a single subagent that explores and explains in one pass, with
\`subagent_type: pstack-judgment-read\`.

The agent does its own exploration`,
    },
    {
      old: `Once all explorers return, spawn a single Task subagent to synthesize their findings into one coherent explanation:

- \`subagent_type\`: \`generalPurpose\`
- \`model\`: your configured how-explainer model (default \`claude-fable-5-thinking-max\`)
- \`readonly\`: \`true\`

`,
      new: `Once all explorers return, spawn a single subagent to synthesize their findings into one
coherent explanation, with \`subagent_type: pstack-judgment-read\`.
`,
    },
    {
      old: `After the explanation is complete, spawn one architectural critic per model in your configured how-critics list (defaults \`claude-fable-5-thinking-max\`, \`gpt-5.6-sol-max\`, \`grok-4.6-fast-xhigh\`, \`claude-opus-5-thinking-xhigh\`), all in a single message.

For each critic:
- \`subagent_type\`: \`generalPurpose\`
- \`model\`: one model from the configured how-critics list. These are minimum reasoning levels. The lead should escalate any model when the architecture warrants deeper analysis.
- \`readonly\`: \`true\`

`,
      new: `After the explanation is complete, spawn one architectural critic per panel agent, all in
a single message:

| Critic | Subagent |
|--------|----------|
| A | \`pstack-judgment-read\` |
| B | \`pstack-precise-read\` |
| C | \`pstack-fast-read\` |
| D | \`pstack-opus-read\` |

Four agents, four different models, none able to write. The diversity is the point. Running
four critics on one model gives you one opinion four times.
`,
    },
  ],
  "why/SKILL.md": [
    {
      why: "why: investigators and synthesizer",
      old: `Subagent config (each):
- \`subagent_type\`: \`generalPurpose\`
- \`model\`: your configured why-investigators model (default \`grok-4.6-fast-xhigh\`)
- \`readonly\`: \`false\` (agent mode). **Do not use readonly/Ask mode.** It strips MCP access, which disables MCP-backed investigators entirely. The source control investigator would be safe in readonly, but keep modes uniform. Investigators still shouldn't write anything. That's a posture, not a sandbox.

`,
      new: `Spawn each investigator with \`subagent_type: pstack-fast-read\`.

That agent cannot write and still has full MCP access. Upstream pstack warns against
read-only mode here because Cursor's read-only stripped MCP, which would disable every
MCP-backed investigator. opencode has no such coupling, so read-only is a real sandbox
rather than a posture, and the warning does not apply.
`,
    },
    {
      old: `Spawn one synthesizer subagent:

- \`subagent_type\`: \`generalPurpose\`
- \`model\`: your configured why-synthesizer model (default \`claude-fable-5-thinking-max\`)
- \`readonly\`: \`false\` (agent mode). The synthesizer's quality check spot-verifies citations, which can require MCP access. Readonly/Ask mode strips MCPs and defeats that.
`,
      new: `Spawn one synthesizer subagent with \`subagent_type: pstack-judgment-read\`.

Its quality check spot-verifies citations, which needs MCP access. The \`-read\` agents keep
MCP, so read-only does not defeat that here.
`,
    },
  ],
  "interrogate/SKILL.md": [
    {
      why: "interrogate: reviewer panel",
      old: `
| Subagent | Default model |
|----------|---------------|
| Reviewer A | \`claude-fable-5-thinking-max\` |
| Reviewer B | \`gpt-5.6-sol-max\` |
| Reviewer C | \`grok-4.6-fast-xhigh\` |
| Reviewer D | \`claude-opus-5-thinking-xhigh\` |

For each reviewer:
- \`subagent_type\`: \`generalPurpose\`
- \`model\`: the configured \`interrogate reviewers\` entry, or the table default with no configured line
- \`readonly\`: \`true\`

If a model slug is rejected as unresolvable when you try to spawn the subagent, check the valid slugs in the Task tool's error message, pick the closest equivalent (prefer the highest-reasoning tier of the same family), spawn with the valid slug, and open a separate PR to update the configured value or default table. Do not block the review on the slug issue. If the configured value is \`inherit-parent\` or \`auto\`, omit \`model\` instead; never treat those aliases as broken slugs or enter this fallback for them.
`,
      new: `Launch all four reviewers in a single message, one \`task\` call each:

| Reviewer | Subagent |
|----------|----------|
| A | \`pstack-judgment-read\` |
| B | \`pstack-precise-read\` |
| C | \`pstack-fast-read\` |
| D | \`pstack-opus-read\` |

Each pins a different model and none can write. Model choice is the subagent you pick, so
there is no slug to get wrong and no \`model\` parameter to pass. Run \`/setup-pstack\` to
change which model backs a role.

Use fewer than four only when the artifact is genuinely small. Adding a fifth reviewer means
reusing a model, which buys agreement rather than coverage.
`,
    },
  ],
  "arena/SKILL.md": [
    {
      why: "arena: runners, fan-out, cross-judge",
      old: `3. Pick the runners. Use \`arena runners\` from \`~/.cursor/rules/pstack-models.mdc\` when present. Otherwise default to one each on \`claude-fable-5-thinking-max\`, \`gpt-5.6-sol-max\`, \`grok-4.6-fast-xhigh\`, \`claude-opus-5-thinking-xhigh\`. Spawn more when the arena covers multiple design directions. Same model N times when the work is generation-bound rather than judgment-sensitive.`,
      new: `3. Pick the runners. Default to one each on \`pstack-judgment\`, \`pstack-precise\`,
   \`pstack-fast\`, \`pstack-opus\`, which is four different models. Spawn more when the arena
   covers multiple design directions. Reuse one agent N times when the work is
   generation-bound rather than judgment-sensitive. Run \`/setup-pstack\` to change which
   model backs a role.`,
    },
    {
      old: `Spawn all N subagents in one message with \`run_in_background: true\`, each with the task, the path to the shared grounding, its own output path, and instructions to produce both the artifact and a short rationale.`,
      new: `Spawn all N subagents in one message, each with the task, the path to the shared
grounding, its own output path, and instructions to produce both the artifact and a short
rationale. Candidates write, so use the write-capable agents here, not the \`-read\` variants.`,
    },
    {
      old: `After all Phase B candidates complete, choose one model from the \`arena cross-judge pool\` in \`~/.cursor/rules/pstack-models.mdc\` when present. Otherwise use \`claude-fable-5-thinking-max\`, \`gpt-5.6-sol-max\`, \`grok-4.6-fast-xhigh\`, \`claude-opus-5-thinking-xhigh\`. Prefer a different model family from the parent's. Spawn one readonly judge subagent on that model. It sees the rubric and the candidates by path label, scores each criterion, and recommends a base with rationale. It runs in parallel with the parent's reading in Phase D, not with the candidates themselves. Spawning while candidates are still writing means the judge sees partial or empty outputs and reports them as dropouts.`,
      new: `After all Phase B candidates complete, pick one judge from \`pstack-judgment-read\`,
\`pstack-precise-read\`, \`pstack-fast-read\`, \`pstack-opus-read\`. Prefer a different model
family from this chat's own model, so \`pstack-precise-read\` when the chat runs on Anthropic.
Spawn exactly one; the \`-read\` agents cannot write, which is what makes a judge safe.`,
    },
  ],
  "swarm/SKILL.md": [
    {
      why: "swarm: worker model, and the cloud fan-out that has no opencode analog",
      old: `3. Set N from the user or derive it from the shape. N is total workers, not the cloud concurrency limit.
4. Pick the worker model from \`swarm workers\` in \`~/.cursor/rules/pstack-models.mdc\` when present. Otherwise use \`grok-4.6-fast-xhigh\`. For a model race, name each arm's model up front.`,
      new: `3. Set N from the user or derive it from the shape. Workers run locally and are awaited,
   so N is bounded by this machine and your patience, not by a cloud quota. Keep it in the
   single digits unless the slices are tiny.
4. Workers run on \`pstack-fast\` by default. Use \`pstack-fast-read\` when the slice only
   reads. For a model race, name each arm's agent up front and pick genuinely different
   ones, since two arms on the same agent race the same model against itself.`,
    },
    {
      old: `Spawn all N workers in one message with \`subagent_type: generalPurpose\`, \`environment: "cloud"\`, \`run_in_background: true\`, and the configured model. Use \`environment: "local"\` only when the worker needs access to something on the user's computer.

When a worker must start from a non-default pushed branch, pass \`cloud_base_branch\`.

`,
      new: `Spawn all N workers in one message, one \`task\` call each, with the agent chosen in Phase A.

**Degraded from upstream pstack.** Upstream runs workers as Cursor cloud agents, which have
their own checkout and their own base branch. opencode has no equivalent, so every worker
runs locally against this working tree and the parent waits for all of them. Two
consequences you must design around.

- Workers share one filesystem. Give each its own output path (worktree, branch, or
  \`/tmp/swarm-<slug>/worker-<n>/\`) per the **separate-before-serializing-shared-state**
  principle skill. This is now mandatory, not a nicety.
- There is no \`cloud_base_branch\`. A worker that must start from a non-default branch needs
  a real \`git worktree\` on that branch, created by you in Phase A, with its path in the brief.
`,
    },
  ],
  "architect/SKILL.md": [
    {
      why: "architect",
      old: `Use your configured architect runners (defaults \`claude-fable-5-thinking-max\`, \`gpt-5.6-sol-max\`, \`grok-4.6-fast-xhigh\`, \`claude-opus-5-thinking-xhigh\`).`,
      new: `Use one runner per panel agent: \`pstack-judgment\`, \`pstack-precise\`, \`pstack-fast\`,
\`pstack-opus\`. Those four pin four different models, which is where the design diversity
comes from. Run \`/setup-pstack\` to change which model backs a role.`,
    },
  ],
  "reflect/SKILL.md": [
    {
      why: "reflect: reviewers, synthesizer, transcript discovery",
      old: `The parent finds its own transcript file before fanning out. The system prompt names the active workspace's \`agent-transcripts/\` directory; use that path. Do not glob across \`~/.cursor/projects/*/\`. That crosses workspace boundaries and reads private chats from unrelated projects.`,
      new: `The parent captures its own transcript before fanning out. Run

\`\`\`
bun run ~/.config/opencode/skills/poteto-mode/scripts/session-digest.ts latest --tools > /tmp/reflect-transcript.md
\`\`\`

from the project directory, and pass that file path to the reviewers. The script scopes to
the current project by filtering on each session's recorded directory. Never pass
\`--all-projects\`; that reads private chats from unrelated projects.`,
    },
    {
      old: `One message, three \`Task\` calls, \`subagent_type: generalPurpose\`, explicit \`model:\` on each, agent mode (\`readonly: false\`). Reviewers need MCP access for context lookups (tickets, chat threads, observability traces referenced in the transcript); readonly strips MCPs. The prompt forbids file writes; the parent applies edits.`,
      new: `One message, three \`task\` calls, one per row in the table below. The \`-read\` agents keep
MCP access for context lookups (tickets, chat threads, observability traces referenced in the
transcript) while being unable to write, so the parent applies every edit.`,
    },
    {
      old: `| Judgment | your configured reflect-judgment model (default \`claude-fable-5-thinking-max\`) | \`references/judgment-reviewer.md\` |
| Tooling | your configured reflect-tooling model (default \`gpt-5.6-sol-max\`) | \`references/tooling-reviewer.md\` |
| Divergent | your configured reflect-judgment model (default \`claude-fable-5-thinking-max\`) | \`references/divergent-reviewer.md\` |`,
      new: `| Judgment | \`pstack-judgment-read\` | \`references/judgment-reviewer.md\` |
| Tooling | \`pstack-precise-read\` | \`references/tooling-reviewer.md\` |
| Divergent | \`pstack-opus-read\` | \`references/divergent-reviewer.md\` |`,
    },
    {
      old: `One \`Task\` call, \`subagent_type: generalPurpose\`, using your configured reflect-judgment model (default \`claude-fable-5-thinking-max\`), agent mode (\`readonly: false\`). The synthesizer's quality check includes spot-verifying citations, which can require MCP access; readonly strips MCPs. Use \`references/synthesizer.md\` verbatim, with each reviewer's full output inlined where marked. The synthesizer returns a structured Accepted / Rejected / Backlog list.`,
      new: `One \`task\` call with \`subagent_type: pstack-judgment-read\`. Its quality check spot-verifies
citations, which needs MCP access; the \`-read\` agents keep it. Use \`references/synthesizer.md\` verbatim`,
    },
  ],
  "automate-me/SKILL.md": [
    {
      old: `Locate the active workspace's transcripts before fanning out. The system prompt names the workspace's \`agent-transcripts/\` directory. Use only that path. Don't glob across \`~/.cursor/projects/*/\`. That crosses workspace boundaries and reads private chats from unrelated projects.`,
      new: `Capture this session's transcript with

\`\`\`
bun run ~/.config/opencode/skills/poteto-mode/scripts/session-digest.ts latest --tools
\`\`\`

run from the project directory. The script scopes to the current project by filtering on
each session's recorded directory, and \`list\` / \`find\` show what else is available for this
project. Never pass \`--all-projects\`; that reads private chats from unrelated projects.`,
    },
  ],
  "show-me-your-work/SKILL.md": [
    {
      old: `At the end of the run, before handing back, check the log told the truth. Read this run's transcript under the active workspace's \`agent-transcripts/\` directory (the system prompt names the path). Don't glob across \`~/.cursor/projects/*/\`; that reads unrelated private chats. Walk the log against what actually happened:`,
      new: `At the end of the run, before handing back, check the log told the truth. Capture this session's transcript with

\`\`\`
bun run ~/.config/opencode/skills/poteto-mode/scripts/session-digest.ts latest --tools
\`\`\`

run from the project directory. The script scopes to the current project by filtering on
each session's recorded directory, and \`list\` / \`find\` show what else is available for this
project. Never pass \`--all-projects\`; that reads private chats from unrelated projects.

Walk the log against what actually happened:`,
    },
  ],
  "poteto-mode/SKILL.md": [
    {
      why: "poteto-mode: the Subagents section is the whole port in miniature",
      old: `**Use \`subagent_type: "poteto-agent"\` for any subagent you spawn inside a playbook step** (code-writing delegates, ad-hoc helpers). \`/poteto-mode\` and \`poteto-agent\` route through the same wrapper. Routed workflow skills (\`how\`, \`why\`, \`interrogate\`, \`reflect\`, \`swarm\`) set their own \`subagent_type\` for diverse-model review; respect what the skill prescribes, don't override to \`poteto-agent\`.

**Defaults for every \`Task\` call.** \`run_in_background: true\`, agent mode (readonly strips MCP), file pointers not inlined context, explicit model per role (configurable via \`/setup-pstack\`; defaults \`grok-4.6-fast-xhigh\` for code, \`claude-fable-5-thinking-max\` for prose and judgment). Code delegates tier by difficulty. The hardest changes (cross-cutting design, gnarly concurrency, subtle algorithms) go to your strongest judgment model (\`claude-fable-5-thinking-max\`) when the task needs judgment or the intent is vague, and to your strongest instruction-following model (\`gpt-5.6-sol-max\`) when the work is a precisely specified sequence of steps to execute to the letter; trivial mechanical edits go to your fast code model. Per-role lines in the \`/setup-pstack\` rule override these defaults and the model choices in the routed skills (\`how\`, \`why\`, \`arena\`, \`swarm\`, \`architect\`, \`interrogate\`, \`reflect\`); a role with no line keeps its default, and a role line of \`inherit-parent\` or \`auto\` runs that role on the parent chat model (omit Task \`model\`).
`,
      new: `**In opencode, model choice is which subagent you pick.** \`task\` accepts
\`description\`, \`prompt\`, \`subagent_type\`, \`task_id\` and nothing else. There is no \`model\`,
\`readonly\`, \`run_in_background\`, or \`environment\` parameter. Every per-call knob upstream
pstack reaches for is instead baked into an agent definition.

| Subagent | Model role | Writes | Use for |
|----------|-----------|--------|---------|
| \`pstack-fast\` | fast | yes | trivial mechanical edits, swarm workers |
| \`pstack-precise\` | strongest instruction-following | yes | a precisely specified sequence of steps to execute to the letter |
| \`pstack-judgment\` | strongest judgment | yes | the hardest changes: cross-cutting design, gnarly concurrency, subtle algorithms, vague intent |
| \`pstack-opus\` | fourth panel model | yes | panel member, second opinions |
| \`pstack-*-read\` | same as above | no | every review, critique, investigation, and exploration path |
| \`poteto-agent\` | this chat's model | yes | a delegate that should inherit your own model and this style |
| \`comment-sicko\` | judgment | no | comment review |

**Use \`subagent_type: poteto-agent\` for an ad-hoc delegate inside a playbook step** when it
should run on this chat's model and carry this style. Tier code delegates by difficulty using
the table above. Routed workflow skills (\`how\`, \`why\`, \`interrogate\`, \`reflect\`, \`swarm\`,
\`arena\`, \`architect\`) name their own subagents for diverse-model review; respect what the
skill prescribes and don't override to \`poteto-agent\`.

**Reach for a \`-read\` variant by default.** It cannot write, and it keeps MCP access. Only
use a write-capable agent when the delegate must actually produce a diff.

**Defaults for every \`task\` call.** File pointers, not inlined context. One writer per
output path. Subagents are awaited, not backgrounded, so scope each one to finish.

Run \`/setup-pstack\` to change which model backs which role.
`,
    },
    {
      old: `- Shipping UI / IDE / CLI → the matching control skill. \`cursor-team-kit\` publishes \`control-cli\` (CLIs and TUIs) and \`control-ui\` (browser / Electron / web UIs). For bug fixes, reproduce first on the same surface yourself; hand to the user only under the narrow Bug fix step 1 exception.`,
      new: `- Shipping UI / IDE / CLI → drive the real surface yourself. There is no bundled control skill here, so use the project's own \`verify-*\` skill, or generate one with **create-verification-skill** when none exists. For bug fixes, reproduce first on the same surface yourself; hand to the user only under the narrow Bug fix step 1 exception.`,
    },
    {
      why: "Playbooks whose autonomy story depends on Cursor cloud agents cannot be honestly ported. Flag them at the router rather than letting a playbook promise unattended fan-out.",
      old: `- **Opening a PR.** Invoked at the end of every other playbook. \`playbooks/opening-a-pr.md\`.`,
      new: `- **Opening a PR.** Invoked at the end of every other playbook. \`playbooks/opening-a-pr.md\`.

**Degraded in this port.** Upstream pstack runs fan-out as Cursor cloud agents, each with
its own checkout, so a coordinator can supervise many long-lived workers cheaply. opencode
has no equivalent: subagents run locally against this working tree and the parent awaits
them. **Orchestrate**, **Autopilot-full**, and **Autopilot-stack** still work, but flattened
to root-spawns-all with fewer, broader workers. Read the degradation note at the top of each
before promising anyone an unattended run.`,
    },
  ],
  "poteto-mode/playbooks/orchestrate.md": [
    {
      why: "orchestrate: cloud placement has no opencode analog, so worker isolation becomes the coordinator's job",
      old: `- **Worker / verifier.** Always \`environment: "cloud"\` unless the task needs this machine: \`control-ui\` or \`control-cli\` runtime verification (from \`cursor-team-kit\`); reading local transcripts under \`agent-transcripts/\`; simulators and local IDE state; auth that exists only here. Cloud agents cannot read the local store, so their briefs inline what they need or point at repo paths. Prefer fewer, broader workers; one writer per worktree or branch (principle-separate-before-serializing-shared-state). Run a unit's verifier on a different model family from its worker.`,
      new: `- **Worker / verifier.** Always local, always awaited. Every worker shares this machine and this checkout, so the isolation upstream pstack got for free from cloud agents you now have to build: one writer per worktree or branch, no exceptions (**principle-separate-before-serializing-shared-state**). Prefer few, broad workers over many narrow ones, because the coordinator blocks on each fan-out. Workers can read the local store and local transcripts directly, which cloud agents could not, so briefs point at paths instead of inlining content. Run a unit's verifier on a different subagent from its worker, so the model that wrote the code is not the model that clears it.`,
    },
    {
      why: "orchestrate: Cursor named a per-agent store in the system prompt; opencode does not, so the path must be explicit",
      old: `Create \`orchestrate/<project-slug>/\` in the current agent's store (path in the system prompt). Every file has exactly one writer; owners publish facts, readers aggregate at read time. Use \`bun scripts/orch/orch.ts\` for bookkeeping, written below as \`orch\`, while its canonical plain TSV and JSON stay readable without the CLI.`,
      new: `Create the store at \`.opencode/orchestrate/<project-slug>/\` inside the project, so it travels
with the repo and survives a restart. Nothing in opencode names a per-agent store directory,
so pick this path explicitly and put it in every brief; a worker cannot find a store it was
not told about.

Every file has exactly one writer; owners publish facts, readers aggregate at read time. Use

\`\`\`
bun run ~/.config/opencode/skills/poteto-mode/scripts/orch/orch.ts --store .opencode/orchestrate/<project-slug>
\`\`\`

for bookkeeping, written below as \`orch\`, while its canonical plain TSV and JSON stay
readable without the CLI.`,
    },
    {
      why: "orchestrate: lead with the degradation so nobody plans a hundred-agent program on awaited local subagents",
      old: `### Orchestrate`,
      new: `### Orchestrate

**DEGRADED IN THIS PORT.** Upstream pstack runs workers as Cursor cloud agents: each gets its
own checkout, runs unattended, and is polled rather than awaited. opencode has none of that.
Subagents run locally against this one working tree and the coordinator blocks until each
returns. What survives is the bookkeeping discipline, the brief-is-the-product rule, and the
frontier logic. What does not survive is cheap unattended concurrency.

Three consequences, and they change how you plan a program.

- **Fan-out costs coordinator wall-clock.** Prefer few broad workers. A hundred-subagent
  program is not achievable here.
- **Every worker shares one filesystem.** Worktrees are mandatory, not an optimization.
- **Nesting depth is capped by config.** Upstream relies on depth 3 (coordinator, track,
  worker). opencode caps this with \`subagent_depth\`, currently 4 in
  \`~/.opencode/opencode.jsonc\`, so depth 3 fits. Verify it before relying on it, and if a
  spawn is refused fall back to root-spawns-all: the coordinator makes every \`task\` call and
  a worker needing help returns a \`NEEDS_HELPER\` request instead of spawning its own.

Read that before promising anyone an overnight run.`,
    },
  ],
  "poteto-mode/playbooks/autopilot-full.md": [
    {
      why: "lead with the degradation; this playbook's autonomy story depends on Cursor cloud agents",
      old: `### Autopilot-full`,
      new: `### Autopilot-full

**DEGRADED IN THIS PORT.** This playbook assumes Cursor cloud agents: one long-lived owner
per PR, each in its own checkout, polled on a wake chain while the root sleeps. opencode has
none of those. Subagents run locally against this one working tree, the root blocks on every
fan-out, and nothing re-arms itself between turns.

What that changes.

- **One owner at a time, not a queue in flight.** Take PRs sequentially, or give each owner
  its own \`git worktree\` and accept that the root waits.
- **No wake chain.** Audit ticks happen when you drive them in this session. Close the
  session and the run stops.
- **Nesting is shallow.** An owner spawning its own verifier is depth 3, which is unverified
  here. Have the root spawn verifiers itself.

The verdict discipline is what is worth keeping: nothing merges without an independent
verdict from an agent that did not write the code.`,
    },
  ],
  "poteto-mode/playbooks/autopilot-stack.md": [
    {
      why: "lead with the degradation; this playbook's autonomy story depends on Cursor cloud agents",
      old: `### Autopilot-stack`,
      new: `### Autopilot-stack

**DEGRADED IN THIS PORT.** Same constraint as **Autopilot-full**. Owners are local awaited
subagents, not cloud agents, so the queue runs narrow rather than wide and there is no
sleeper wake chain for audit ticks. Give every owner its own \`git worktree\`, since they share
one filesystem, and let the root spawn verifiers rather than nesting them under owners.

The Graphite mechanics and the single-writer-on-topology rule port unchanged, and they are
the part that actually keeps a stack landable.`,
    },
  ],
  "poteto-mode/playbooks/autonomous-run.md": [
    {
      why: "lead with the degradation; this playbook's autonomy story depends on Cursor cloud agents",
      old: `### Autonomous run`,
      new: `### Autonomous run

**Bounded by the session in this port.** Cursor's \`/loop\` could re-arm a sleeping agent.
opencode cannot: nothing wakes a session, so an autonomous run lasts exactly as long as this
session does. Drive the loop yourself in-session, and checkpoint through the
**show-me-your-work** skill so a fresh session can resume from the trail rather than restart.`,
    },
  ],
}
