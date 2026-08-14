#!/usr/bin/env bun
/**
 * Read opencode session transcripts for the current project.
 *
 * pstack was written against Cursor, which named a per-workspace transcript directory in
 * the system prompt. opencode has no such thing. It keeps sessions in a content store
 * under ~/.local/share/opencode/storage/ keyed by session id, with the project directory
 * recorded inside each session record. So the scoping that pstack got from Cursor's
 * per-workspace layout has to be done here, by filtering on that directory field.
 *
 * That filter is the privacy boundary pstack cares about. Reading another project's
 * sessions means reading unrelated private chats, so `list` and `digest` never leave the
 * current project unless you pass --all-projects explicitly.
 *
 * Layout:
 *   storage/session/<projectHash>/<sessionID>.json   { id, directory, projectID, title, time, summary }
 *   storage/message/<sessionID>/<messageID>.json     { id, role, time }
 *   storage/part/<messageID>/<partID>.json           { type, text, ... }
 *
 * Usage:
 *   session-digest.ts list [--all-projects] [--limit N]
 *   session-digest.ts digest <sessionID> [--tools] [--reasoning] [--max-chars N]
 *   session-digest.ts latest [--tools] [--reasoning]
 *   session-digest.ts find <substring> [--all-projects]
 *
 * `list` and `find` print TSV. `digest` prints markdown. Both are meant to be read by an
 * agent, so neither paginates or colors output.
 */

import { existsSync } from "node:fs"
import { readFile, readdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const STORAGE = process.env.OPENCODE_STORAGE ?? join(homedir(), ".local/share/opencode/storage")

type Session = {
  id: string
  directory?: string
  projectID?: string
  title?: string
  summary?: unknown
  time?: { created?: number; updated?: number }
}

type Message = { id: string; role?: string; time?: { created?: number } }
type Part = { id: string; type?: string; text?: string; tool?: string; state?: { title?: string } }

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T
  } catch {
    return null
  }
}

async function listDir(path: string): Promise<string[]> {
  if (!existsSync(path)) return []
  return (await readdir(path, { withFileTypes: true })).map((e) => e.name).filter((n) => n !== ".DS_Store")
}

async function allSessions(): Promise<Session[]> {
  const root = join(STORAGE, "session")
  const out: Session[] = []
  for (const bucket of await listDir(root)) {
    for (const file of await listDir(join(root, bucket))) {
      if (!file.endsWith(".json")) continue
      const s = await readJson<Session>(join(root, bucket, file))
      if (s?.id) out.push(s)
    }
  }
  return out.sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
}

/** Sessions for one project directory. This is the privacy boundary; keep it. */
function scope(sessions: Session[], allProjects: boolean, cwd: string): Session[] {
  if (allProjects) return sessions
  return sessions.filter((s) => s.directory === cwd)
}

function ts(ms?: number): string {
  return ms ? new Date(ms).toISOString().replace("T", " ").slice(0, 19) : "-"
}

/**
 * Flatten anything the store hands back into one TSV-safe line.
 *
 * Not every field is the type it looks like. `session.summary` is an object in about half
 * the records on disk and null in the rest, so treating it as a string throws. The store
 * is opencode's private schema and will drift again, so coerce rather than assume.
 */
function clean(v: unknown): string {
  if (v == null) return ""
  const s = typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v)
  return s.replace(/[\t\r\n]+/g, " ").trim()
}

async function digest(sessionID: string, opts: { tools: boolean; reasoning: boolean; maxChars: number }) {
  const sessions = await allSessions()
  const session = sessions.find((s) => s.id === sessionID)
  if (!session) throw new Error(`no session ${sessionID} under ${STORAGE}`)

  const msgDir = join(STORAGE, "message", sessionID)
  const messages: Message[] = []
  for (const f of await listDir(msgDir)) {
    if (!f.endsWith(".json")) continue
    const m = await readJson<Message>(join(msgDir, f))
    if (m?.id) messages.push(m)
  }
  messages.sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))

  const lines: string[] = [
    `# ${session.title ?? sessionID}`,
    "",
    `- session: \`${sessionID}\``,
    `- directory: \`${session.directory ?? "unknown"}\``,
    `- created: ${ts(session.time?.created)}`,
    `- updated: ${ts(session.time?.updated)}`,
    `- messages: ${messages.length}`,
    "",
  ]
  // Only prose summaries are worth surfacing. In practice this field usually holds diff
  // stats ({additions, deletions, files}), which say nothing about what the session did.
  if (typeof session.summary === "string" && session.summary.trim()) {
    lines.push(`> ${clean(session.summary)}`, "")
  }

  let budget = opts.maxChars
  for (const m of messages) {
    const partDir = join(STORAGE, "part", m.id)
    const parts: Part[] = []
    for (const f of await listDir(partDir)) {
      if (!f.endsWith(".json")) continue
      const p = await readJson<Part>(join(partDir, f))
      if (p) parts.push(p)
    }
    parts.sort((a, b) => a.id.localeCompare(b.id))

    const chunks: string[] = []
    for (const p of parts) {
      if (p.type === "text" && p.text) chunks.push(p.text.trim())
      else if (p.type === "reasoning" && opts.reasoning && p.text) chunks.push(`_(reasoning)_ ${p.text.trim()}`)
      else if (p.type === "tool" && opts.tools) chunks.push(`\`${p.tool ?? "tool"}\` ${clean(p.state?.title ?? "")}`)
      else if (p.type === "patch") chunks.push("_(patch applied)_")
    }
    if (!chunks.length) continue

    let body = chunks.join("\n\n")
    if (budget <= 0) {
      lines.push("", `_(truncated at ${opts.maxChars} chars; raise with --max-chars)_`)
      break
    }
    if (body.length > budget) body = body.slice(0, budget) + " …"
    budget -= body.length

    lines.push(`## ${m.role ?? "unknown"} · ${ts(m.time?.created)}`, "", body, "")
  }

  console.log(lines.join("\n"))
}

async function main() {
  const argv = process.argv.slice(2)
  const cmd = argv[0]
  const flags = new Set(argv.filter((a) => a.startsWith("--")))
  const positional = argv.slice(1).filter((a) => !a.startsWith("--"))
  const numFlag = (name: string, fallback: number) => {
    const i = argv.indexOf(`--${name}`)
    return i === -1 ? fallback : Number(argv[i + 1] ?? fallback)
  }
  const allProjects = flags.has("--all-projects")
  const cwd = process.cwd()

  if (cmd === "list" || cmd === "find") {
    const needle = cmd === "find" ? (positional[0] ?? "").toLowerCase() : null
    if (cmd === "find" && !needle) throw new Error("find needs a substring")
    let rows = scope(await allSessions(), allProjects, cwd)
    if (needle) {
      rows = rows.filter(
        (s) => clean(s.title).toLowerCase().includes(needle) || clean(s.summary).toLowerCase().includes(needle),
      )
    }
    const limit = numFlag("limit", cmd === "list" ? 30 : 100)
    console.log(["updated", "session", "directory", "title"].join("\t"))
    for (const s of rows.slice(0, limit)) {
      console.log([ts(s.time?.updated), s.id, s.directory ?? "-", clean(s.title) || "-"].join("\t"))
    }
    if (!rows.length) {
      console.error(
        allProjects
          ? "no sessions found"
          : `no sessions recorded for ${cwd}. Pass --all-projects only if you actually need other projects' private chats.`,
      )
    }
    return
  }

  if (cmd === "digest" || cmd === "latest") {
    const opts = { tools: flags.has("--tools"), reasoning: flags.has("--reasoning"), maxChars: numFlag("max-chars", 60000) }
    if (cmd === "latest") {
      const rows = scope(await allSessions(), allProjects, cwd)
      if (!rows.length) throw new Error(`no sessions recorded for ${cwd}`)
      await digest(rows[0].id, opts)
      return
    }
    if (!positional[0]) throw new Error("digest needs a session id; run `list` first")
    await digest(positional[0], opts)
    return
  }

  console.error(
    [
      "usage:",
      "  session-digest.ts list [--all-projects] [--limit N]",
      "  session-digest.ts find <substring> [--all-projects]",
      "  session-digest.ts digest <sessionID> [--tools] [--reasoning] [--max-chars N]",
      "  session-digest.ts latest [--tools] [--reasoning]",
    ].join("\n"),
  )
  process.exit(1)
}

await main()
