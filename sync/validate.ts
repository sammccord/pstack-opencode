/**
 * Post-sync gate. Every check here caught a real failure mode during the port.
 *
 * The load-bearing one is the name/dir match. pstack ships `name: Poteto Mode`, which is
 * regex-invalid for opencode. Copy it verbatim and the hub skill silently never loads,
 * taking the whole plugin down with it. Silent, so it needs a test.
 */

import { existsSync, statSync } from "node:fs"
import { readFile, readdir, mkdir, mkdtemp, symlink, rm } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** Idioms that must not survive the transform. */
const FORBIDDEN: Array<[RegExp, string]> = [
  [/\.cursor\b/, "Cursor path"],
  [/\bgeneralPurpose\b/, "Cursor builtin subagent, opencode has `general`"],
  [/\bAskQuestion\b/, "opencode tool is `question`"],
  [/\brun_in_background\b/, "not a task parameter in opencode"],
  [/\benvironment:\s*["']?cloud/, "no cloud agents in opencode"],
  [/\bcloud_base_branch\b/, "no cloud agents in opencode"],
  [/^\s*[-*]?\s*`?readonly`?:\s*`?(true|false)/, "readonly is per-agent in opencode, not per-call"],
  [/\bcursor-team-kit\b/, "plugin does not exist here"],
  [/`control-(cli|ui)`/, "skill not installed"],
  [/pstack-models\.mdc/, "config surface moved to agent/*.md"],
  [/\bComment Sicko\b/, "agent name must be kebab-case"],
  [/\bis_background\b/, "not an opencode agent field"],
  [/`\/loop`/, "no /loop in opencode"],
  [/`\/deslop`(?!ify)/, "maps to /deslopify"],
  [/\bCursor\b/, "product name"],
  [/\ballow_multiple\b/, "question tool param is `multiple`"],
]

/**
 * The subset that is always a bug in a generated config file, never commentary.
 * `Cursor` and `readonly` are omitted here because these files legitimately explain
 * which Cursor mechanisms do not exist in opencode.
 */
const FORBIDDEN_IN_CONFIG: Array<[RegExp, string]> = [
  [/\.cursor\b/, "Cursor path"],
  [/\bgeneralPurpose\b/, "Cursor builtin subagent, opencode has `general`"],
  [/pstack-models\.mdc/, "config surface moved to agent/*.md"],
  [/\bis_background\b/, "not an opencode agent field"],
]

/** Subagent names opencode ships. Anything else must exist in agent/. */
const BUILTIN_AGENTS = new Set(["general", "explore", "scout", "build", "plan"])

export type ValidateArgs = {
  opencodeDir: string
  skills: string[]
  agents: string[]
  commands: string[]
  /** Lines authored in patches.ts or overlay/. Exempt from the forbidden-idiom scan. */
  authored?: Set<string>
}

/**
 * Resolve the binary that actually runs opencode here.
 *
 * Order matters. `cbcode` bundles its own opencode under node_modules, and that is the live
 * runtime; a `~/.opencode/bin/opencode` left over from a standalone install can be a much
 * older build that disagrees on recognized config keys and on whether `hidden` may be a
 * string. Validating against the stale one produced two confidently wrong conclusions during
 * the initial port, so the bundled build is preferred and `which opencode` is the last
 * resort. Returns null when nothing is found; the caller then skips the parse check rather
 * than failing, so the pipeline still runs on a machine without opencode on PATH.
 */
function findOpencodeBin(): string | null {
  if (process.env.OPENCODE_BIN && existsSync(process.env.OPENCODE_BIN)) return process.env.OPENCODE_BIN
  const arch = `${process.platform}-${process.arch === "x64" ? "x64" : process.arch}`
  const nodeRoots = process.env.NVM_DIR
    ? [join(process.env.NVM_DIR, "versions/node")]
    : [join(homedir(), ".nvm/versions/node")]
  const bundled = nodeRoots.flatMap((base) => {
    try {
      return require("node:fs")
        .readdirSync(base)
        .map((v: string) =>
          join(base, v, `lib/node_modules/@cbhq/code-agent/node_modules/opencode-${arch}/bin/opencode`),
        )
    } catch {
      return []
    }
  })
  for (const c of [...bundled, join(homedir(), ".opencode/bin/opencode")]) {
    if (existsSync(c)) return c
  }
  return Bun.which("opencode")
}

async function walk(root: string, sub = ""): Promise<string[]> {
  const dir = join(root, sub)
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === ".DS_Store") continue
    const rel = sub ? join(sub, e.name) : e.name
    if (e.isDirectory()) out.push(...(await walk(root, rel)))
    else out.push(rel)
  }
  return out
}

export async function validate({
  opencodeDir,
  skills,
  agents,
  commands,
  authored = new Set<string>(),
}: ValidateArgs): Promise<string[]> {
  const failures: string[] = []
  const skillsDir = join(opencodeDir, "skills")
  const agentDir = join(opencodeDir, "agent")
  const commandDir = join(opencodeDir, "command")

  const ours = new Set(skills)
  const files = (await walk(skillsDir)).filter((f) => ours.has(f.split("/")[0]))

  // 1. No residual Cursor-isms in transformed upstream content.
  //
  // Scoped to the skills tree on purpose. That is the imported prose, so it is the only
  // real risk surface. The generated agent and command files are hand-authored here and
  // legitimately discuss what opencode lacks ("there is no `readonly` parameter"), which
  // would trip every one of these rules.
  for (const rel of files) {
    if (!rel.endsWith(".md")) continue
    const text = await readFile(join(skillsDir, rel), "utf8")
    const lines = text.split("\n")
    for (const [re, why] of FORBIDDEN) {
      for (let i = 0; i < lines.length; i++) {
        if (!re.test(lines[i])) continue
        if (authored.has(lines[i].trim())) continue
        failures.push(`skills/${rel}:${i + 1} ${why}: ${lines[i].trim().slice(0, 110)}`)
      }
    }
  }

  // Generated config files get the narrow subset that is always an error, never commentary.
  // Scoped to our own filenames so the user's pre-existing commands are never touched.
  const generatedConfig = [
    ...agents.map((a) => join(agentDir, `${a}.md`)),
    ...commands.map((c) => join(commandDir, `${c}.md`)),
  ]
  for (const path of generatedConfig) {
    if (!existsSync(path)) {
      failures.push(`${path} missing`)
      continue
    }
    const lines = (await readFile(path, "utf8")).split("\n")
    for (const [re, why] of FORBIDDEN_IN_CONFIG) {
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) failures.push(`${path}:${i + 1} ${why}: ${lines[i].trim().slice(0, 110)}`)
      }
    }
  }

  // 2. Frontmatter contract. A violation here means the skill silently does not load.
  for (const name of skills) {
    const path = join(skillsDir, name, "SKILL.md")
    if (!existsSync(path)) {
      failures.push(`skills/${name}/SKILL.md missing`)
      continue
    }
    const text = await readFile(path, "utf8")
    if (!text.startsWith("---\n")) {
      failures.push(`skills/${name}/SKILL.md does not start with frontmatter`)
      continue
    }
    const fm = text.slice(4, text.indexOf("\n---\n", 3) + 1)
    const nameM = /^name:\s*(.*)$/m.exec(fm)
    if (!nameM) failures.push(`skills/${name}/SKILL.md missing name`)
    else {
      const got = nameM[1].trim()
      if (got !== name) failures.push(`skills/${name}/SKILL.md name is "${got}", must equal dir name "${name}"`)
      if (!NAME_RE.test(got)) failures.push(`skills/${name}/SKILL.md name "${got}" fails ${NAME_RE}`)
    }
    const descM = /^description:\s*(.*)$/m.exec(fm)
    if (!descM || !descM[1].trim()) failures.push(`skills/${name}/SKILL.md missing description`)
    else if (descM[1].trim().length > 1024)
      failures.push(`skills/${name}/SKILL.md description is ${descM[1].trim().length} chars, cap is 1024`)

    for (const line of fm.split("\n")) {
      const m = /^([A-Za-z0-9_-]+):/.exec(line)
      if (!m) continue
      if (!["name", "description", "license", "compatibility", "metadata"].includes(m[1]))
        failures.push(`skills/${name}/SKILL.md has unrecognized frontmatter field "${m[1]}"`)
    }
  }

  // 3. Nesting. opencode globs skills/*/SKILL.md, exactly one level.
  for (const rel of files) {
    if (rel.endsWith("SKILL.md") && rel.split("/").length > 2)
      failures.push(`skills/${rel} is nested; opencode only discovers skills/<name>/SKILL.md`)
  }

  // 4. Every referenced subagent must resolve. A typo here fails at runtime, not at load.
  //
  // Requires the value to be quoted or backticked. Matching bare words also swallows prose
  // like "set their own `subagent_type` for diverse-model review", which reads "for" as an
  // agent name.
  const known = new Set([...BUILTIN_AGENTS, ...agents])
  const SUBAGENT_REF = /subagent_type`?\s*:\s*(?:`([a-z][a-z0-9-]*)`|"([a-z][a-z0-9-]*)"|'([a-z][a-z0-9-]*)')/g
  for (const rel of files) {
    if (!rel.endsWith(".md")) continue
    const text = await readFile(join(skillsDir, rel), "utf8")
    const lines = text.split("\n")
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(SUBAGENT_REF)) {
        const ref = m[1] ?? m[2] ?? m[3]
        if (!known.has(ref)) failures.push(`skills/${rel}:${i + 1} unknown subagent_type "${ref}"`)
      }
    }
  }

  // 5. opencode itself must parse every generated agent.
  //
  // Static checks cannot catch this class. An unquoted `#e8b923` for `color` is a YAML
  // comment, so the key parsed empty and opencode rejected the entire file, and a `color:
  // warning` theme name (which the docs list as valid) is rejected by this build outright.
  // Both failures are invisible in the file and fatal at load, so ask the binary.
  //
  // Hermetic: point opencode at a throwaway config dir built from the just-generated outputs
  // via XDG_CONFIG_HOME (this build honors it; a project-level `.opencode/` is not picked up
  // by `agent list`). That validates the repo's own files without requiring them to be
  // symlinked into ~/.config/opencode first, so `bun sync` is safe on a fresh clone and never
  // reads the user's live config. Skipped, not failed, when no binary is found.
  const bin = findOpencodeBin()
  if (bin) {
    const xdg = await mkdtemp(join(tmpdir(), "pstack-validate-"))
    try {
      const cfg = join(xdg, "opencode")
      await mkdir(cfg, { recursive: true })
      for (const kind of ["agent", "command", "skills"]) {
        const from = join(opencodeDir, kind)
        if (existsSync(from)) await symlink(from, join(cfg, kind))
      }
      const proc = Bun.spawnSync([bin, "agent", "list"], {
        cwd: xdg,
        env: { ...process.env, XDG_CONFIG_HOME: xdg },
        stdout: "pipe",
        stderr: "pipe",
      })
      const out = new TextDecoder().decode(proc.stdout) + new TextDecoder().decode(proc.stderr)
      if (/is invalid|is not valid/.test(out)) {
        failures.push(`opencode rejected the config: ${out.trim().split("\n")[0]}`)
      } else {
        for (const a of agents) {
          if (!new RegExp(`^${a}\\s`, "m").test(out))
            failures.push(`agent/${a}.md did not load (absent from \`opencode agent list\`)`)
        }
      }
    } finally {
      await rm(xdg, { recursive: true, force: true })
    }
  }

  // 6. Scripts kept their executable bit through the copy.
  for (const rel of ["poteto-mode/scripts/watch-pr/watch-pr", "poteto-mode/scripts/orch/orch.ts", "poteto-mode/scripts/worktree-audit.sh"]) {
    const p = join(skillsDir, rel)
    if (!existsSync(p)) {
      failures.push(`skills/${rel} missing`)
      continue
    }
    if (!(statSync(p).mode & 0o111)) failures.push(`skills/${rel} lost its executable bit`)
  }

  // 7. Relative script invocations break once skills live outside a repo.
  for (const rel of files) {
    if (!rel.endsWith(".md")) continue
    const text = await readFile(join(skillsDir, rel), "utf8")
    const lines = text.split("\n")
    for (let i = 0; i < lines.length; i++) {
      if (/(?<![\w/.~])scripts\/(watch-pr|orch|worktree-audit|session-digest)/.test(lines[i]))
        failures.push(
          `skills/${rel}:${i + 1} relative script path; skills live outside the repo so this must be absolute: ${lines[i].trim().slice(0, 100)}`,
        )
    }
  }

  return failures
}

if (import.meta.main) {
  const OC = process.env.OPENCODE_CONFIG ?? dirname(import.meta.dir)
  const lock = JSON.parse(await readFile(join(import.meta.dir, "pstack-lock.json"), "utf8"))
  const authoredPath = join(import.meta.dir, "authored-lines.json")
  const authored = existsSync(authoredPath)
    ? new Set<string>(JSON.parse(await readFile(authoredPath, "utf8")))
    : new Set<string>()
  const failures = await validate({
    opencodeDir: OC,
    skills: lock.skills,
    agents: lock.agents,
    commands: lock.commands,
    authored,
  })
  if (failures.length) {
    console.error(`validate: ${failures.length} failure(s)`)
    for (const f of failures) console.error(`  ${f}`)
    process.exit(1)
  }
  console.log("validate: clean")
}
