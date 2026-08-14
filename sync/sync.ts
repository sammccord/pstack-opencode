#!/usr/bin/env bun
/**
 * pstack -> opencode sync.
 *
 * Pipeline: copy allowlist -> frontmatter normalize -> rewrites.tsv -> overlay
 *           -> generate agents + commands -> validate -> lock.
 *
 * Idempotent. Re-run after an upstream pstack bump.
 * Generated agent/*.md and command/*.md are clobbered every run. Never hand-edit them;
 * edit models.json (or run /setup-pstack) and re-sync.
 */

import { $ } from "bun"
import { createHash } from "node:crypto"
import { existsSync, statSync } from "node:fs"
import { mkdir, readFile, readdir, rm, writeFile, chmod, copyFile } from "node:fs/promises"
import { dirname, join, relative } from "node:path"

import { generateAgents } from "./agents.ts"
import { generateCommands, COMMAND_SKILLS } from "./commands.ts"
import { PATCHES } from "./patches.ts"
import { validate } from "./validate.ts"

const HERE = import.meta.dir
const REPO = dirname(HERE)

// Upstream pstack checkout. Defaults to the bootstrap cache that bin/bootstrap.sh populates
// (a pinned partial clone of cursor/plugins); override with PSTACK_SRC to reuse an existing
// checkout.
const SRC = process.env.PSTACK_SRC ?? join(REPO, ".cache/pstack-src/pstack")

// Where generated files land. Defaults to the repo root, so `skills/`, `agent/`, and
// `command/` are vendored and diffable in git; bin/install.sh symlinks them into the live
// opencode config. Override with OPENCODE_CONFIG only to write elsewhere.
const OC = process.env.OPENCODE_CONFIG ?? REPO

const SKILLS_OUT = join(OC, "skills")
const AGENT_OUT = join(OC, "agent")
const COMMAND_OUT = join(OC, "command")
const OVERLAY = join(HERE, "overlay", "skills")
const LOCK = join(HERE, "pstack-lock.json")

/** Frontmatter fields opencode recognizes. Everything else is dropped. */
const KEEP_FIELDS = new Set(["name", "description", "license", "compatibility", "metadata"])

/** Directories under pstack/ that we copy. Everything else is dropped. */
const COPY_ROOTS = ["skills"]

type Rewrite = { re: RegExp; to: string; note: string }

function sha256(s: string | Buffer) {
  return createHash("sha256").update(s).digest("hex")
}

async function loadRewrites(): Promise<Rewrite[]> {
  const raw = await readFile(join(HERE, "rewrites.tsv"), "utf8")
  const out: Rewrite[] = []
  for (const line of raw.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue
    const parts = line.split("\t")
    if (parts.length < 2) throw new Error(`rewrites.tsv: need at least 2 tab-separated fields: ${line}`)
    const [pattern, to, note = ""] = parts
    out.push({ re: new RegExp(pattern, "gm"), to, note })
  }
  return out
}

/** List every file under a dir, recursively, as paths relative to that dir. */
async function walk(root: string, sub = ""): Promise<string[]> {
  const dir = join(root, sub)
  if (!existsSync(dir)) return []
  const entries = await readdir(dir, { withFileTypes: true })
  const out: string[] = []
  for (const e of entries) {
    if (e.name === ".DS_Store") continue
    const rel = sub ? join(sub, e.name) : e.name
    if (e.isDirectory()) out.push(...(await walk(root, rel)))
    else out.push(rel)
  }
  return out
}

/**
 * Split frontmatter from body. Returns null frontmatter when the file has none.
 * Deliberately dumb: we only need flat `key: value` plus nested `metadata:` blocks.
 */
function splitFrontmatter(text: string): { fm: string | null; body: string } {
  if (!text.startsWith("---\n")) return { fm: null, body: text }
  const end = text.indexOf("\n---\n", 3)
  if (end === -1) return { fm: null, body: text }
  return { fm: text.slice(4, end + 1), body: text.slice(end + 5) }
}

/**
 * Rewrite frontmatter to opencode's schema.
 * - keeps only recognized fields
 * - forces `name` to equal the containing directory (opencode requires it, and
 *   pstack ships `name: Poteto Mode` which is regex-invalid and would silently
 *   drop the whole hub skill)
 * - asserts description length
 */
function normalizeFrontmatter(
  fm: string,
  skillName: string,
  path: string,
  descriptions: Record<string, string>,
): string {
  const lines = fm.split("\n").filter((l) => l.length > 0)
  const kept: string[] = []
  let sawName = false
  let sawDescription = false
  let inKeptBlock = false

  for (const line of lines) {
    const isContinuation = /^\s+/.test(line)
    if (isContinuation) {
      if (inKeptBlock) kept.push(line)
      continue
    }
    const m = /^([A-Za-z0-9_-]+):(.*)$/.exec(line)
    if (!m) {
      inKeptBlock = false
      continue
    }
    const [, key, rest] = m
    if (!KEEP_FIELDS.has(key)) {
      inKeptBlock = false
      continue
    }
    inKeptBlock = true
    if (key === "name") {
      sawName = true
      kept.push(`name: ${skillName}`)
      continue
    }
    if (key === "description") {
      sawDescription = true
      const inline = rest.trim()
      if (inline && inline.length > 1024) {
        throw new Error(`${path}: description is ${inline.length} chars, opencode caps it at 1024`)
      }
      descriptions[skillName] = inline
    }
    kept.push(`${key}:${rest}`)
  }

  if (!sawName) kept.unshift(`name: ${skillName}`)
  if (!sawDescription) throw new Error(`${path}: missing required frontmatter field 'description'`)
  return `---\n${kept.join("\n")}\n---\n`
}

/**
 * Sentinels marking text we authored in patches.ts, so the rewrite pass leaves it alone.
 *
 * Patches run before rewrites so their anchors sit on pristine upstream text. That makes an
 * anchor failure mean "upstream reworded this", which is the signal worth stopping for,
 * instead of "I edited a rule". But patch output is already opencode-shaped and some of it
 * deliberately names Cursor to explain what is missing, so the rules must not touch it.
 */
const GUARD_OPEN = "\u0000pstackguard\u0000"
const GUARD_CLOSE = "\u0001pstackguard\u0001"

function applyRewrites(text: string, rewrites: Rewrite[]): string {
  // Rewrite only the unguarded spans, then drop the sentinels.
  const parts = text.split(GUARD_OPEN)
  const out: string[] = [applyRules(parts[0], rewrites)]
  for (const part of parts.slice(1)) {
    const close = part.indexOf(GUARD_CLOSE)
    if (close === -1) throw new Error("unbalanced patch guard; a patch `new` text lost its sentinel")
    out.push(part.slice(0, close), applyRules(part.slice(close + GUARD_CLOSE.length), rewrites))
  }
  return out.join("")
}

function applyRules(text: string, rewrites: Rewrite[]): string {
  let out = text
  for (const r of rewrites) out = out.replace(r.re, r.to)
  return out
}

/**
 * Apply the semantic patches for one file.
 *
 * A patch whose anchor no longer matches exactly once is a hard error, not a warning.
 * Skipping it would ship a skill that tells the agent to pass a `model` parameter opencode
 * does not have, and nothing downstream would notice.
 */
function applyPatches(rel: string, text: string, failures: string[]): string {
  const patches = PATCHES[rel]
  if (!patches) return text
  let out = text
  for (const p of patches) {
    const n = out.split(p.old).length - 1
    if (n !== 1) {
      const head = p.old.trim().split("\n")[0].slice(0, 90)
      failures.push(`patches.ts ${rel}: anchor matched ${n} times, need exactly 1: ${head}`)
      continue
    }
    out = out.replace(p.old, GUARD_OPEN + p.new + GUARD_CLOSE)
  }
  return out
}

async function writeOut(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const dryRun = args.has("--dry-run")
  const skipValidate = args.has("--no-validate")

  if (!existsSync(SRC)) throw new Error(`pstack source not found at ${SRC}. Set PSTACK_SRC.`)

  const rewrites = await loadRewrites()
  const manifest = JSON.parse(await readFile(join(SRC, ".cursor-plugin/plugin.json"), "utf8"))
  const models = JSON.parse(await readFile(join(HERE, "models.json"), "utf8"))
  const pinPath = join(HERE, "pstack.pin")
  const pin = existsSync(pinPath)
    ? JSON.parse(await readFile(pinPath, "utf8"))
    : { remote: null, commit: null, subdir: "pstack" }

  // Enumerate source skills.
  const skillDirs = (await readdir(join(SRC, "skills"), { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()

  const overlayFiles = new Set(await walk(OVERLAY))
  const generated: Record<string, string> = {}
  const descriptions: Record<string, string> = {}
  const patchFailures: string[] = []
  const stats = { skills: 0, files: 0, overlaid: 0, rewritten: 0, scripts: 0, patched: 0 }

  for (const root of COPY_ROOTS) {
    for (const rel of await walk(join(SRC, root))) {
      const skillName = rel.split("/")[0]
      const srcPath = join(SRC, root, rel)
      const outPath = join(SKILLS_OUT, rel)

      // Non-markdown (scripts, lockfiles, tsv templates) copies through verbatim.
      if (!rel.endsWith(".md")) {
        if (!dryRun) {
          await mkdir(dirname(outPath), { recursive: true })
          await copyFile(srcPath, outPath)
          const mode = statSync(srcPath).mode & 0o777
          await chmod(outPath, mode)
        }
        stats.files++
        stats.scripts++
        generated[relative(OC, outPath)] = sha256(await readFile(srcPath))
        continue
      }

      let text: string
      if (overlayFiles.has(rel)) {
        // Overlay wins wholesale. Hand-authored, already opencode-shaped.
        text = await readFile(join(OVERLAY, rel), "utf8")
        stats.overlaid++
      } else {
        text = await readFile(srcPath, "utf8")
        if (PATCHES[rel]) {
          text = applyPatches(rel, text, patchFailures)
          stats.patched++
        }
        text = applyRewrites(text, rewrites)
        stats.rewritten++
      }

      // SKILL.md gets frontmatter normalization. references/ and playbooks/ have none.
      if (rel.endsWith("/SKILL.md") && rel.split("/").length === 2) {
        const { fm, body } = splitFrontmatter(text)
        if (!fm) throw new Error(`${rel}: SKILL.md has no frontmatter`)
        text = normalizeFrontmatter(fm, skillName, rel, descriptions) + body
        stats.skills++
      }

      if (!dryRun) await writeOut(outPath, text)
      stats.files++
      generated[relative(OC, outPath)] = sha256(text)
    }
  }

  // Overlay files with no source counterpart (new files we add, e.g. session-digest docs).
  for (const rel of overlayFiles) {
    if (existsSync(join(SRC, "skills", rel))) continue
    const text = await readFile(join(OVERLAY, rel), "utf8")
    const outPath = join(SKILLS_OUT, rel)
    if (!dryRun) await writeOut(outPath, text)
    generated[relative(OC, outPath)] = sha256(text)
    stats.files++
    stats.overlaid++
  }

  // Generated config surfaces.
  const agents = generateAgents(models)
  for (const [name, content] of Object.entries(agents)) {
    const outPath = join(AGENT_OUT, `${name}.md`)
    if (!dryRun) await writeOut(outPath, content)
    generated[relative(OC, outPath)] = sha256(content)
  }

  const commands = generateCommands(descriptions)
  for (const [name, content] of Object.entries(commands)) {
    const outPath = join(COMMAND_OUT, `${name}.md`)
    if (!dryRun) await writeOut(outPath, content)
    generated[relative(OC, outPath)] = sha256(content)
  }

  console.log(
    `skills ${stats.skills}  files ${stats.files}  overlaid ${stats.overlaid}  ` +
      `rewritten ${stats.rewritten}  patched ${stats.patched}  verbatim ${stats.scripts}  ` +
      `agents ${Object.keys(agents).length}  commands ${Object.keys(commands).length}`,
  )

  if (patchFailures.length) {
    console.error(`\npatches: ${patchFailures.length} anchor(s) did not match`)
    for (const f of patchFailures) console.error(`  ${f}`)
    console.error("\nAn upstream pstack release probably reworded these passages.")
    console.error("Update patches.ts, or move the file to overlay/ if little survives.")
    process.exit(1)
  }

  const unusedPatchFiles = Object.keys(PATCHES).filter((rel) => !existsSync(join(SRC, "skills", rel)))
  if (unusedPatchFiles.length) {
    console.error(`\npatches: target file(s) no longer exist upstream: ${unusedPatchFiles.join(", ")}`)
    process.exit(1)
  }

  if (dryRun) {
    console.log("dry run, nothing written")
    return
  }

  // Provenance for the validator.
  //
  // The forbidden-idiom scan cannot tell "this skill tells the agent to pass a Cursor
  // parameter" from "this skill explains that the Cursor parameter does not exist here".
  // Both mention it. So record every line we authored ourselves, in patches.ts and overlay/,
  // and let the validator skip exactly those. Upstream text stays fully policed; text we
  // wrote is our own accountability. No hand-maintained allowlist to drift.
  const authored = new Set<string>()
  for (const patches of Object.values(PATCHES)) {
    for (const patch of patches) {
      for (const line of patch.new.split("\n")) {
        const t = line.trim()
        if (t) authored.add(t)
      }
    }
  }
  for (const rel of overlayFiles) {
    if (!rel.endsWith(".md")) continue
    for (const line of (await readFile(join(OVERLAY, rel), "utf8")).split("\n")) {
      const t = line.trim()
      if (t) authored.add(t)
    }
  }
  await writeFile(join(HERE, "authored-lines.json"), JSON.stringify([...authored].sort(), null, 0) + "\n")

  const lock = {
    pstackVersion: manifest.version,
    pstackRemote: pin.remote,
    pstackCommit: pin.commit,
    transformVersion: 1,
    syncedAt: new Date().toISOString(),
    rewriteRules: rewrites.length,
    overlays: [...overlayFiles].sort(),
    skills: skillDirs,
    commands: COMMAND_SKILLS,
    agents: Object.keys(agents).sort(),
    files: Object.fromEntries(Object.entries(generated).sort(([a], [b]) => a.localeCompare(b))),
  }
  await writeFile(LOCK, JSON.stringify(lock, null, 2) + "\n")

  if (!skipValidate) {
    const failures = await validate({
      opencodeDir: OC,
      skills: skillDirs,
      agents: Object.keys(agents),
      commands: Object.keys(commands),
      authored,
    })
    if (failures.length) {
      console.error(`\nvalidate: ${failures.length} failure(s)`)
      for (const f of failures) console.error(`  ${f}`)
      process.exit(1)
    }
    console.log("validate: clean")
  }
}

await main()
