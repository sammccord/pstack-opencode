---
name: why
description: "Use for 'why does X work this way', 'why we picked Y', design rationale, regressions, postmortems, or data-backed thresholds. Discovers available MCPs and queries each evidence category (source control, issue tracker, long-form docs, real-time chat, infrastructure observability, error tracking, product analytics warehouse) in parallel, then returns a cited read on decisions and tradeoffs. Use how for runtime behavior."
argument-hint: "<decision, design, or behavior to explain>"
---

# Why

Load the `why` skill with `skill({ name: "why" })` and execute it.

## Input

Arguments: $ARGUMENTS

## Parse Modifiers

Check `$ARGUMENTS` for modifiers:
- `-f` / `--fast`: Lowest reasoning effort. Prioritise speed — skip deliberation, act immediately.
- `-l` / `--low`: Low reasoning effort. Think less, act faster.
- `-h` / `--high`: High reasoning effort. Think more carefully, verify assumptions.
- `-xh` / `--extra-high`: Ultrathink. Maximum reasoning depth — use for complex, high-stakes, or ambiguous tasks.
- `-v` / `--verbose`: Show more detail.
- `-q` / `--quiet`: Minimal output.
- `-i` / `--interactive`: Ask for confirmation at each step.

Any MCP modifier can be appended to steer tool selection: `--gh` GitHub, `--lin` Linear, `--gw` Google Workspace, `--sg` Sourcegraph, `--gln` Glean, `--dd` Datadog, `--sn` Sentry, `--pd` PagerDuty, `--cf` Codeflow, `--cs` Config Service, `--tp` Temporal, `--sf` Snowflake, `--db` Databricks, `--amp` Amplitude.

A reasoning modifier does not license skipping a step the skill names. Lower effort means less deliberation per step, not fewer steps.

## Steps

Follow the `why` skill exactly as written. Do not improvise around its steps or
substitute your own plan for its plan. If the skill names a subagent, use that subagent.
If it names a reference file, read that file.

Model choice in opencode is which subagent you spawn, not a `task` parameter. The
`pstack-*` agents pin the models; `-read` variants cannot write. Run `/setup-pstack`
to change which model backs which role.

**Suggested next steps:**
- `/how` for the mechanics
- `/recall` for prior session context
