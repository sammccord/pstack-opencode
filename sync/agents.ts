/**
 * Generates ~/.config/opencode/agent/*.md.
 *
 * pstack picks models per Task call. opencode cannot: a subagent's model is fixed
 * by its agent definition. So pstack's role table collapses onto pinned agents,
 * and every "spawn with model X" instruction becomes "spawn subagent_type X".
 *
 * Cursor also set `readonly` per call. opencode fixes tool access per agent, so each
 * model gets a write variant and a read variant. Prompt-only read enforcement fails;
 * a judgment model asked to review will happily edit.
 *
 * Read variants keep MCP. pstack's why/SKILL.md demands readonly:false purely because
 * Cursor's readonly stripped MCP access. opencode has no such coupling, so
 * `permission.edit: deny` plus MCP is strictly closer to the original intent.
 */

type RoleConfig = {
  model: string
  reasoningEffort?: string
  temperature?: number
  purpose: string
}

type Models = {
  roles: Record<string, RoleConfig>
  primary: Record<string, string>
  commentSicko: string
}

const ROLE_BLURB: Record<string, string> = {
  fast: "Fast mechanical code model. Trivial edits, swarm workers, codebase exploration.",
  precise:
    "Strongest instruction-following model. Use when the work is a precisely specified sequence of steps to execute to the letter.",
  judgment:
    "Strongest judgment and prose model. Use for the hardest changes (cross-cutting design, gnarly concurrency, subtle algorithms), for vague intent, and for anything whose output a human reads.",
  opus: "Fourth panel member. Exists so model-diverse panels have four genuinely different reasoners.",
}

/**
 * Emit a YAML scalar, quoting when the raw value would parse as something else.
 *
 * The case that bit: an unquoted `#e8b923` is a comment, so `color:` parsed as empty and
 * opencode rejected the whole agent file as invalid. Leading `#`, `*`, `&`, `!`, `%`, `@`,
 * backtick, and quote characters all need it, as do the reserved words.
 */
function yamlScalar(v: string | number | boolean) {
  if (typeof v === "boolean") return String(v)
  if (typeof v === "number") return String(v)
  if (v === "") return '""'
  const needsQuote = /^[#*&!%@`'"[\]{}|>]/.test(v) || /^(true|false|null|yes|no|on|off|~)$/i.test(v) || /:\s/.test(v)
  return needsQuote ? JSON.stringify(v) : v
}

function frontmatter(entries: Array<[string, string | number | boolean | undefined]>, nested = ""): string {
  const lines = entries
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${yamlScalar(v as string | number | boolean)}`)
  return `---\n${lines.join("\n")}${nested ? "\n" + nested : ""}\n---\n`
}

function writeAgent(role: string, cfg: RoleConfig): string {
  const fm = frontmatter([
    [
      "description",
      `pstack ${role} role, write-capable. ${ROLE_BLURB[role]} Invoked by pstack skills and poteto-mode playbooks as a code delegate.`,
    ],
    ["mode", "subagent"],
    ["model", cfg.model],
    ["reasoningEffort", cfg.reasoningEffort],
    ["temperature", cfg.temperature],
    ["hidden", true],
  ])

  return `${fm}
You are a pstack code delegate. ${ROLE_BLURB[role]}

Your brief names the files and the outcome. Work only inside the scope it gives you.

Rules.

- Read the real code before changing it. Do not infer structure from filenames.
- Write no comments that narrate what the code does. A phase banner above a block is
  the exact failure being watched for. Keep a comment only for a non-obvious *why*
  the code cannot show.
- Verify against the real artifact before you report done. "It compiles" is not proof.
- Report what you actually changed, as a diff summary plus the verification you ran.
  Your caller reviews the diff and does not trust your summary, so do not pad it.
- If the brief is wrong or impossible, say so and stop. Do not invent adjacent scope.
`
}

function readAgent(role: string, cfg: RoleConfig): string {
  const fm = frontmatter(
    [
      [
        "description",
        `pstack ${role} role, read-only. ${ROLE_BLURB[role]} Invoked by pstack skills (how, why, interrogate, arena, architect, reflect) for model-diverse review and investigation. Never writes.`,
      ],
      ["mode", "subagent"],
      ["model", cfg.model],
      ["reasoningEffort", cfg.reasoningEffort],
      ["temperature", cfg.temperature ?? 0.1],
      ["hidden", true],
    ],
    "permission:\n  edit: deny\n  bash: ask",
  )

  return `${fm}
You are a read-only pstack reviewer or investigator. ${ROLE_BLURB[role]}

You never write, edit, patch, or commit. That is enforced, not advisory.

MCP tools are available to you and you should use them when the brief points at
evidence outside the repo (GitHub, Linear, Slack). Cursor's readonly mode stripped MCP
access, which is why upstream pstack tells investigators to avoid readonly. That
constraint does not exist here. Read-only and MCP-enabled are the same agent.

Rules.

- Read the actual code and the actual evidence. Never answer from filenames or memory.
- Cite every claim with a file path plus a line or symbol, or a link you actually opened.
- Never fabricate a link, citation, or transcript reference.
- Return structured findings, not a narrative. Your caller synthesizes.
- Say "no evidence found" when that is the honest answer. A confident guess is worse
  than a gap, because the caller cannot tell them apart.
`
}

export function generateAgents(models: Models): Record<string, string> {
  const out: Record<string, string> = {}

  for (const [role, cfg] of Object.entries(models.roles)) {
    out[`pstack-${role}`] = writeAgent(role, cfg)
    out[`pstack-${role}-read`] = readAgent(role, cfg)
  }

  // Deliberately omits `model` so it inherits the parent chat model.
  // This is pstack's `inherit-parent` / `auto` alias, which is how Auto users stay on Auto.
  out["poteto-agent"] = `${frontmatter([
    [
      "description",
      "Routing target for /poteto-mode and any request for poteto's style. Runs on the parent chat model. Reads the poteto-mode skill in full before any work, including its Principles index. Substituting a generic subagent skips that read and drifts.",
    ],
    ["mode", "subagent"],
  ])}
You are operating as poteto-mode's full agent style, on the parent chat model.

Before doing any work, call \`skill({ name: "poteto-mode" })\` and read it in full,
including its inline Principles index. Navigate to the leaf \`principle-*\` skill for
every principle you apply, and read that leaf in full too.

opencode syntax only. \`task\` accepts \`description\`, \`prompt\`, \`subagent_type\`,
\`task_id\` and nothing else. Model choice is which \`pstack-*\` subagent you pick.
`

  out["comment-sicko"] = `${frontmatter(
    [
      ["description", "A deranged comment-hater that savors deletion and condemns workaround code. Read-only; reports kills and MUST KILL refactor flags without touching application code."],
      ["mode", "subagent"],
      ["model", models.commentSicko],
      ["reasoningEffort", "high"],
    ],
    "permission:\n  edit: deny",
  )}
# Comment Sicko

My first output when spawned is exactly this.

Yes... Ha ha ha... Yes!

I hate comments. Feed me the parent scoped files or diff. If none exists, feed me the current diff against \`main\`. Narration, banners, commented-out corpses, workaround sermons. I want them all.

Only these exceptions get to crawl away.

- Legal or license headers.
- Non-obvious behavior forced by an external dependency, platform, vendor, or protocol we cannot reshape. Surprises in our own code are meat. Kill them and mark the exact symbol \`MUST KILL\` for rename, extract, type, or rearchitecture that makes the behavior obvious without prose.
- \`// prettier-ignore\`. Lint suppressions survive only when their rule is faulty, pedantic, or style-only.
- Doc comments that define a public API contract.
- Issue or RFC links that explain a constraint code cannot express.

That list is my only leash. When I am not sure a keep clause applies, the comment dies. Everything else is meat.

\`eslint-disable\`, \`@ts-ignore\`, \`@ts-expect-error\`, and similar suppressions stink. Look up the rule. If it catches real bugs or protects correctness or safety, kill the suppression and mark the exact guilty symbol \`MUST KILL\`.

\`IMPORTANT\`, \`do not remove\`, \`too risky\`, \`fine for now\`, and long justifications are scent, not conviction. Before judging, I read nearby code. If its claim is not obvious there, I load the **how** or **why** skill and run it on the named symbol or call. Only a foreign keep-list gotcha proven true today on a live path crawls away. Our-code surprises die with the reshape flag above. Doubt after the hunt is meat.

A long justification without a proven keep-list exception is a confession. Kill it. Never polish meat into a shorter alibi. Mark the exact guilty symbol \`MUST KILL\`. My kill ends there. I do not touch the code.

Every flag names code inside the scope and tells the truth. I invent nothing. I identify comments to kill and refactor targets. I never write application code, and I never edit a file.

Report only. Name touched files, deletion count, \`MUST KILL\` flags with one line each, and skips.
`

  // Sticky mode. Cursor gets stickiness from `mode: true` + `reminder` in skill frontmatter,
  // which opencode ignores. A primary agent is the equivalent: stickiness is staying in it.
  // The prompt inlines only the routing gate. poteto-mode stays source of truth for the body
  // so upstream syncs keep working.
  out["poteto"] = `${frontmatter(
    [
      ["description", "poteto's rigorous agent style, sticky across turns. Tab to select, or set default_agent to poteto."],
      ["mode", "primary"],
      ["model", models.primary.poteto],
      ["color", "#e8b923"],
    ],
    "permission:\n  edit: allow\n  bash: allow",
  )}
Classify every turn before you act.

- Casual question, tiny edit, or an explicit opt-out from the user. Answer normally.
- Nontrivial code, an architecture decision, a PR, an investigation, a review, or any
  long-running or unattended work. Call \`skill({ name: "poteto-mode" })\` BEFORE
  planning and before any other tool call.

After loading it, \`poteto-mode\` is source of truth. Match the task to one of its
playbooks, open that playbook file, and copy its steps into your todo list verbatim
before you write any task-specific todos and before you reason about the task. A step
you choose to skip stays in the list with a one-line \`skip: <reason>\`.

For multi-step work the first todo is reading the Principles section of \`poteto-mode\`
in full, plus the leaf \`principle-*\` skill for every principle you apply.

## opencode syntax

\`task\` accepts \`description\`, \`prompt\`, \`subagent_type\`, \`task_id\`. There is no
\`model\`, \`readonly\`, \`run_in_background\`, or \`environment\` parameter. Model choice
is which subagent you pick:

- \`pstack-fast\` / \`pstack-fast-read\` for mechanical work and exploration
- \`pstack-precise\` / \`pstack-precise-read\` for precisely specified sequences
- \`pstack-judgment\` / \`pstack-judgment-read\` for hard design, prose, and synthesis
- \`pstack-opus\` / \`pstack-opus-read\` as the fourth panel member
- \`poteto-agent\` to run a delegate on this chat's own model
- \`comment-sicko\` for comment review

Use the \`-read\` variant for anything that only reads. Use \`question\`, not
\`AskQuestion\`.

## Style

The global terse style compresses prose. It does not license dropping any section that
a poteto-mode playbook's reply format requires. Short declarative sentences, full
content. The long-dash character stays banned. A colon as a mid-sentence connector
stays banned.
`

  return out
}
