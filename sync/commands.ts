/**
 * Generates ~/.config/opencode/command/*.md, one thin wrapper per pstack workflow skill.
 *
 * The 21 `principle-*` skills deliberately get no command. They are reference prose that
 * poteto-mode tells the agent to load, not workflows a human invokes.
 *
 * Wrappers stay thin on purpose. The skill is the source of truth; duplicating its steps
 * here would rot on the next upstream sync.
 */

/** Non-principle pstack skills, i.e. the ones a human invokes directly. */
export const COMMAND_SKILLS = [
  "architect",
  "arena",
  "automate-me",
  "blast-radius",
  "bro",
  "create-verification-skill",
  "figure-it-out",
  "how",
  "interrogate",
  "maintain-verification-skill",
  "no-comments",
  "poteto-mode",
  "recall",
  "reflect",
  "setup-pstack",
  "show-me-your-work",
  "swarm",
  "tdd",
  "teach",
  "technical-writing",
  "typescript-best-practices",
  "unslop",
  "why",
] as const

type Meta = { hint: string; title: string; next: string[] }

const META: Record<string, Meta> = {
  architect: {
    hint: "<change or component to design>",
    title: "Architect",
    next: ["`/interrogate` to stress-test the chosen design", "`/arena` for a head-to-head bakeoff"],
  },
  arena: {
    hint: "<design or implementation to run a bakeoff on>",
    title: "Arena",
    next: ["`/interrogate` to adversarially review the winner", "`/architect` if no entrant is good enough"],
  },
  "automate-me": {
    hint: "[topic or behavior to capture]",
    title: "Automate Me",
    next: ["`/reflect` to mine more patterns worth encoding"],
  },
  "blast-radius": {
    hint: "<symbol, file, or change>",
    title: "Blast Radius",
    next: ["`/how` to understand the affected subsystem", "`/tdd` to pin behavior before changing it"],
  },
  bro: { hint: "[what to be blunt about]", title: "Bro", next: [] },
  "create-verification-skill": {
    hint: "[app or surface to verify]",
    title: "Create Verification Skill",
    next: ["`/maintain-verification-skill` once it drifts"],
  },
  "figure-it-out": {
    hint: "<large or cross-cutting task with no matching playbook>",
    title: "Figure It Out",
    next: ["`/poteto-mode` to execute the playbook it designs"],
  },
  how: {
    hint: "[critique] <subsystem or question>",
    title: "How",
    next: ["`/why` for motivation and history", "`/architect` before implementing"],
  },
  interrogate: {
    hint: "<design, plan, or diff to attack>",
    title: "Interrogate",
    next: ["`/architect` if the design does not survive", "`/tdd` to encode the accepted findings"],
  },
  "maintain-verification-skill": {
    hint: "[verification skill name]",
    title: "Maintain Verification Skill",
    next: [],
  },
  "no-comments": {
    hint: "[files or diff scope]",
    title: "No Comments",
    next: ["`/review` for a full diff review", "`/unslop` for prose surfaces"],
  },
  "poteto-mode": {
    hint: "<task>",
    title: "Poteto Mode",
    next: ["Tab to the `poteto` agent to make this stick across turns"],
  },
  recall: {
    hint: "<what to remember from earlier work>",
    title: "Recall",
    next: ["`/reflect` to turn recalled patterns into structure"],
  },
  reflect: {
    hint: "[scope or time window]",
    title: "Reflect",
    next: ["`/automate-me` to encode what you found", "`/create-verification-skill` if proof was the gap"],
  },
  "setup-pstack": {
    hint: "",
    title: "Setup pstack",
    next: ["`/poteto-mode` to start using it"],
  },
  "show-me-your-work": {
    hint: "[task to keep a decision trail for]",
    title: "Show Me Your Work",
    next: [],
  },
  swarm: {
    hint: "<work to fan out in parallel>",
    title: "Swarm",
    next: ["`/arena` for bakeoffs with base selection", "`/interrogate` to review the merged result"],
  },
  tdd: {
    hint: "<behavior to pin with tests>",
    title: "TDD",
    next: ["`/test` to run the suite", "`/blast-radius` to find what else the change touches"],
  },
  teach: { hint: "<concept, subsystem, or skill to learn>", title: "Teach", next: ["`/how` for a code walkthrough"] },
  "technical-writing": {
    hint: "<doc, RFC, readme, PR description, or commit message>",
    title: "Technical Writing",
    next: ["`/unslop` to strip the slop", "`/deslopify` for a final naturalness pass"],
  },
  "typescript-best-practices": {
    hint: "[files or scope]",
    title: "TypeScript Best Practices",
    next: ["`/typecheck` to prove it", "`/no-comments` before review"],
  },
  unslop: {
    hint: "<prose to clean>",
    title: "Unslop",
    next: ["`/deslopify` for a final naturalness pass", "`/technical-writing` for structure"],
  },
  why: {
    hint: "<decision, design, or behavior to explain>",
    title: "Why",
    next: ["`/how` for the mechanics", "`/recall` for prior session context"],
  },
}

const MODIFIERS = `Check \`$ARGUMENTS\` for modifiers:
- \`-f\` / \`--fast\`: Lowest reasoning effort. Prioritise speed — skip deliberation, act immediately.
- \`-l\` / \`--low\`: Low reasoning effort. Think less, act faster.
- \`-h\` / \`--high\`: High reasoning effort. Think more carefully, verify assumptions.
- \`-xh\` / \`--extra-high\`: Ultrathink. Maximum reasoning depth — use for complex, high-stakes, or ambiguous tasks.
- \`-v\` / \`--verbose\`: Show more detail.
- \`-q\` / \`--quiet\`: Minimal output.
- \`-i\` / \`--interactive\`: Ask for confirmation at each step.

Any MCP modifier can be appended to steer tool selection: \`--gh\` GitHub, \`--lin\` Linear, \`--gw\` Google Workspace, \`--sg\` Sourcegraph, \`--gln\` Glean, \`--dd\` Datadog, \`--sn\` Sentry, \`--pd\` PagerDuty, \`--cf\` Codeflow, \`--cs\` Config Service, \`--tp\` Temporal, \`--sf\` Snowflake, \`--db\` Databricks, \`--amp\` Amplitude.

A reasoning modifier does not license skipping a step the skill names. Lower effort means less deliberation per step, not fewer steps.`

/** Normalize a skill's frontmatter description into a command description. */
function commandDescription(name: string, raw: string): string {
  let d = raw.trim()
  if ((d.startsWith('"') && d.endsWith('"')) || (d.startsWith("'") && d.endsWith("'"))) d = d.slice(1, -1)
  if (!d) throw new Error(`${name}: empty description, cannot build a command from it`)
  return d.replace(/\\"/g, '"').replace(/"/g, "'")
}

/** @param descriptions skill name -> raw frontmatter description, captured during sync. */
export function generateCommands(descriptions: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}

  for (const name of COMMAND_SKILLS) {
    const meta = META[name]
    if (!meta) throw new Error(`commands.ts: no META entry for ${name}`)
    const raw = descriptions[name]
    if (raw === undefined) throw new Error(`commands.ts: ${name} has no synced SKILL.md description`)
    const description = commandDescription(name, raw)
    const next = meta.next.length
      ? `\n**Suggested next steps:**\n${meta.next.map((n) => `- ${n}`).join("\n")}\n`
      : ""

    out[name] = `---
name: ${name}
description: "${description}"
argument-hint: "${meta.hint}"
---

# ${meta.title}

Load the \`${name}\` skill with \`skill({ name: "${name}" })\` and execute it.

## Input

Arguments: $ARGUMENTS

## Parse Modifiers

${MODIFIERS}

## Steps

Follow the \`${name}\` skill exactly as written. Do not improvise around its steps or
substitute your own plan for its plan. If the skill names a subagent, use that subagent.
If it names a reference file, read that file.

Model choice in opencode is which subagent you spawn, not a \`task\` parameter. The
\`pstack-*\` agents pin the models; \`-read\` variants cannot write. Run \`/setup-pstack\`
to change which model backs which role.
${next}`
  }

  return out
}
