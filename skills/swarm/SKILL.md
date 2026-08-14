---
name: swarm
description: "Fan out N parallel workers, drain them, and return one report. Use for /swarm, 'swarm this', or parallel coverage, races, gauntlets, and exploration."
---

# Swarm

Fan out N parallel local workers. They may cover separate slices, race the same brief, or mix both. The parent waits, aggregates, and returns one report.

## Start

Open a todo list with one entry per phase before launching anything.

1. Frame
2. Fan out
3. Aggregate
4. Report

## Phase A: Frame

1. State the done predicate and the artifact or report the swarm must return.
2. Choose the shape. Partition into slices, race N workers on identical briefs, or mix both. For a race or mixed shape, declare `first pass`, `rank all`, or `best-of` before spawning.
3. Set N from the user or derive it from the shape. Workers run locally and are awaited,
   so N is bounded by this machine and your patience, not by a cloud quota. Keep it in the
   single digits unless the slices are tiny.
4. Workers run on `pstack-fast` by default. Use `pstack-fast-read` when the slice only
   reads. For a model race, name each arm's agent up front and pick genuinely different
   ones, since two arms on the same agent race the same model against itself.
5. Give each worker its own writable output when it writes. Use a worktree, branch, or `/tmp/swarm-<slug>/worker-<n>/`.

## Phase B: Fan out

Spawn all N workers in one message, one `task` call each, with the agent chosen in Phase A.

**Degraded from upstream pstack.** Upstream runs workers as Cursor cloud agents, which have
their own checkout and their own base branch. opencode has no equivalent, so every worker
runs locally against this working tree and the parent waits for all of them. Two
consequences you must design around.

- Workers share one filesystem. Give each its own output path (worktree, branch, or
  `/tmp/swarm-<slug>/worker-<n>/`) per the **separate-before-serializing-shared-state**
  principle skill. This is now mandatory, not a nicety.
- There is no `cloud_base_branch`. A worker that must start from a non-default branch needs
  a real `git worktree` on that branch, created by you in Phase A, with its path in the brief.
Every brief stands alone. Include the goal, scope, exact slice or race arm, how to verify, and what to report. Reports use `PASS`, `ISSUES`, or `BLOCKED` with evidence.

If a worker drops out, proceed with N-1 and note it.

## Phase C: Aggregate

Read the terminal results. For coverage, every required slice needs a result. For a race, apply the selection rule declared up front. Use first pass, rank all, or best-of. Do not paste raw worker dumps.

Keep a compact result table, one-line evidenced issues, and explicit gaps or dropouts.

## Phase D: Report

Return one consolidated in-chat report with the table, issue one-liners, gaps or dropouts, and the race rule when used.
