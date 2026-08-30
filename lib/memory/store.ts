import fs from "fs";
import path from "path";

// ═══════════════════════════════════════════════════════════════════
//  ULTRON persistent memory layer
//
//  Everything lives as plain JSON under data/memory/ so it survives
//  server restarts, is trivially inspectable, and is easy to back up or
//  sync. Four stores:
//
//   • profile.json      — durable facts about the user & their machine
//                          ("user's name is X", "primary drive is E:",
//                          "prefers dark mode"). Rarely changes.
//   • facts.jsonl       — append-only log of things ULTRON was told to
//                          remember during conversations.
//   • corrections.jsonl — append-only log of "you did X, the right thing
//                          was Y". Injected into the system prompt so the
//                          same mistake isn't repeated.
//   • sessions.jsonl    — rolling per-turn summaries so context carries
//                          across page reloads / restarts.
//
//  Retrieval is deliberately simple keyword scoring — no embeddings, no
//  external service, no network. Good enough for a single-user desktop
//  assistant and keeps the whole thing dependency-free.
// ═══════════════════════════════════════════════════════════════════

const MEMORY_DIR = path.join(process.cwd(), "data", "memory");
const PROFILE_PATH = path.join(MEMORY_DIR, "profile.json");
const FACTS_PATH = path.join(MEMORY_DIR, "facts.jsonl");
const CORRECTIONS_PATH = path.join(MEMORY_DIR, "corrections.jsonl");
const SESSIONS_PATH = path.join(MEMORY_DIR, "sessions.jsonl");

export interface MemoryFact {
  id: string;
  text: string;
  tags: string[];
  createdAt: string;
  source: "user" | "assistant" | "system";
}

export interface Correction {
  id: string;
  mistake: string;
  correction: string;
  context?: string;
  createdAt: string;
}

export interface SessionEntry {
  ts: string;
  userMessage: string;
  assistantReply: string;
  toolsUsed: string[];
}

export interface UserProfile {
  [key: string]: string | string[] | number | boolean;
}

function ensureDir(): void {
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

function readJsonl<T>(file: string): T[] {
  try {
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, "utf-8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as T);
  } catch (err) {
    console.error(`[memory] failed reading ${path.basename(file)}:`, err);
    return [];
  }
}

function appendJsonl(file: string, entry: unknown): void {
  ensureDir();
  fs.appendFileSync(file, JSON.stringify(entry) + "\n", "utf-8");
}

function rewriteJsonl(file: string, entries: unknown[]): void {
  ensureDir();
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// ── Profile ────────────────────────────────────────────────────────
export function getProfile(): UserProfile {
  try {
    if (!fs.existsSync(PROFILE_PATH)) return {};
    return JSON.parse(fs.readFileSync(PROFILE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

export function setProfileKey(key: string, value: UserProfile[string]): UserProfile {
  ensureDir();
  const profile = getProfile();
  profile[key] = value;
  fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2), "utf-8");
  return profile;
}

// ── Facts ──────────────────────────────────────────────────────────
export function addFact(
  text: string,
  opts: { tags?: string[]; source?: MemoryFact["source"] } = {}
): MemoryFact {
  const trimmed = text.trim();
  const existing = readJsonl<MemoryFact>(FACTS_PATH);

  // De-dupe: if an almost-identical fact exists, don't pile another on.
  const dupe = existing.find(
    (f) => f.text.trim().toLowerCase() === trimmed.toLowerCase()
  );
  if (dupe) return dupe;

  const fact: MemoryFact = {
    id: newId("fact"),
    text: trimmed,
    tags: (opts.tags || []).map((t) => t.toLowerCase()),
    createdAt: new Date().toISOString(),
    source: opts.source || "user",
  };
  appendJsonl(FACTS_PATH, fact);
  return fact;
}

export function getAllFacts(): MemoryFact[] {
  return readJsonl<MemoryFact>(FACTS_PATH);
}

export function forgetFact(idOrText: string): boolean {
  const all = readJsonl<MemoryFact>(FACTS_PATH);
  const q = idOrText.trim().toLowerCase();
  const kept = all.filter(
    (f) => f.id !== idOrText && !f.text.toLowerCase().includes(q)
  );
  if (kept.length === all.length) return false;
  rewriteJsonl(FACTS_PATH, kept);
  return true;
}

// ── Corrections ────────────────────────────────────────────────────
export function addCorrection(
  mistake: string,
  correction: string,
  context?: string
): Correction {
  const entry: Correction = {
    id: newId("corr"),
    mistake: mistake.trim(),
    correction: correction.trim(),
    context: context?.trim(),
    createdAt: new Date().toISOString(),
  };
  appendJsonl(CORRECTIONS_PATH, entry);
  return entry;
}

export function getAllCorrections(): Correction[] {
  return readJsonl<Correction>(CORRECTIONS_PATH);
}

// ── Sessions (rolling context) ─────────────────────────────────────
const MAX_SESSION_ENTRIES = 400;

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export function recordTurn(entry: Omit<SessionEntry, "ts">): void {
  const full: SessionEntry = {
    ts: new Date().toISOString(),
    userMessage: clip(entry.userMessage, 400),
    assistantReply: clip(entry.assistantReply, 500),
    toolsUsed: entry.toolsUsed,
  };
  const all = readJsonl<SessionEntry>(SESSIONS_PATH);
  all.push(full);
  // Keep the file bounded — drop the oldest entries.
  const trimmed = all.slice(-MAX_SESSION_ENTRIES);
  rewriteJsonl(SESSIONS_PATH, trimmed);
}

export function getRecentTurns(n = 8): SessionEntry[] {
  return readJsonl<SessionEntry>(SESSIONS_PATH).slice(-n);
}

// ── Retrieval ──────────────────────────────────────────────────────
function scoreText(haystack: string, terms: string[]): number {
  const h = haystack.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (term.length < 2) continue;
    if (h.includes(term)) score += term.length > 4 ? 2 : 1;
  }
  return score;
}

export interface RecallResult {
  facts: MemoryFact[];
  corrections: Correction[];
}

/** Keyword-scored recall of the facts/corrections most relevant to a query. */
export function recall(query: string, limit = 6): RecallResult {
  const terms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const facts = getAllFacts()
    .map((f) => ({ f, s: scoreText(f.text + " " + f.tags.join(" "), terms) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.f);

  const corrections = getAllCorrections()
    .map((c) => ({ c, s: scoreText(c.mistake + " " + c.correction + " " + (c.context || ""), terms) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.c);

  return { facts, corrections };
}

/**
 * Builds the "MEMORY CONTEXT" block injected into the chat system prompt.
 * Always includes the full profile + all corrections (there are never
 * many and they matter every turn), plus the last few conversation turns,
 * plus query-relevant facts. Returns "" when there's nothing to add.
 */
export function buildMemoryContext(query: string): string {
  const profile = getProfile();
  const corrections = getAllCorrections();
  const recentTurns = getRecentTurns(5);
  const { facts } = recall(query, 8);
  const allFacts = getAllFacts();

  // If almost nothing is stored, keep the prompt lean.
  if (
    Object.keys(profile).length === 0 &&
    corrections.length === 0 &&
    recentTurns.length === 0 &&
    allFacts.length === 0
  ) {
    return "";
  }

  const lines: string[] = ["=== ULTRON MEMORY CONTEXT (persistent, from past sessions) ==="];

  if (Object.keys(profile).length > 0) {
    lines.push("\nUSER & SYSTEM PROFILE:");
    for (const [k, v] of Object.entries(profile)) {
      lines.push(`  - ${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
    }
  }

  const relevantFacts = facts.length > 0 ? facts : allFacts.slice(-8);
  if (relevantFacts.length > 0) {
    lines.push("\nREMEMBERED FACTS:");
    for (const f of relevantFacts) lines.push(`  - ${f.text}`);
  }

  if (corrections.length > 0) {
    lines.push("\nCORRECTIONS — do NOT repeat these mistakes:");
    for (const c of corrections.slice(-15)) {
      lines.push(`  - When: ${c.mistake} → Instead: ${c.correction}${c.context ? ` (${c.context})` : ""}`);
    }
  }

  if (recentTurns.length > 0) {
    lines.push("\nRECENT CONVERSATION (most recent last):");
    for (const t of recentTurns) {
      lines.push(`  - User: ${t.userMessage}`);
      lines.push(`    ULTRON: ${t.assistantReply}${t.toolsUsed.length ? ` [used: ${t.toolsUsed.join(", ")}]` : ""}`);
    }
  }

  lines.push("\n=== END MEMORY CONTEXT ===");
  return lines.join("\n");
}

export function memorySnapshot() {
  return {
    profile: getProfile(),
    facts: getAllFacts(),
    corrections: getAllCorrections(),
    recentTurns: getRecentTurns(20),
  };
}
