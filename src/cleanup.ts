// Automatic cleanup (Pro). Once a week, a model on Workers AI reads the user's memories and
// suggests merging duplicates (or a contradiction into the newer fact) and forgetting things
// that are outdated. The user applies or dismisses each suggestion on /cleanup, or turns on
// automatic merging. Everything applied goes through the normal merge and forget, so Pro history
// can undo it.
import type { Env } from "./env";
import {
  CATEGORY_LABELS,
  forgetMemory,
  listActive,
  mergeMemories,
  newId,
  NOW_SQL,
  PLAN_SQL,
  writeAllowance,
  type Memory
} from "./memories";

export const CLEANUP_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
/** Who the History page says made the change. */
export const CLEANUP_EDITOR = "Cleanup";
const CHUNK = 150;
const MAX_CHUNKS = 4;
const MAX_SUGGESTIONS = 30;
/** Accounts processed per hourly run. Each costs up to MAX_CHUNKS model calls. */
const USERS_PER_RUN = 3;
const EVERY_DAYS = 7;
/** "Check now" is allowed once this often. */
export const MANUAL_COOLDOWN_MINUTES = 60;

export interface Suggestion {
  id: string;
  kind: "merge" | "forget";
  memory_ids: string[];
  content: string | null;
  reason: string;
  created_at: string;
}

/** A pending suggestion with the memories it's about (all still active). */
export interface SuggestionView extends Suggestion {
  memories: Memory[];
}

export const cleanupAvailable = (env: Pick<Env, "AI">) => !!env.AI;

const SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["merge", "forget"] },
          ids: { type: "array", items: { type: "string" } },
          content: { type: "string" },
          reason: { type: "string" }
        },
        required: ["kind", "ids", "reason"]
      }
    }
  },
  required: ["suggestions"]
};

function prompt(today: string): string {
  return `You tidy up a person's long-term memory, which their AI assistants share. Each line is one memory: [id] (category; "said" if the person stated it, "inferred" if an assistant guessed it; date learned) text.

Today is ${today}. Suggest only changes you are confident about. Most memories need no change; an empty list is a good answer.

- merge: two or more memories that say the same thing, or that contradict each other where the newer one replaces the older (for example "Lives in Lisbon" learned in August and "Lives in Porto" learned in October). Give every id and one sentence in the third person that keeps every detail worth keeping; for a contradiction, the sentence states the newer fact. Do not merge facts that are merely related.
- forget: a memory that is clearly no longer true or useful, such as a plan whose date has passed or a short-lived "current" item many months old. One id each. Never forget instructions.

Each reason is one short sentence the person will read, e.g. "Both say you're vegetarian." Use each id at most once. Return JSON only.`;
}

const line = (m: Memory) =>
  `[${m.id}] (${CATEGORY_LABELS[m.category]}; ${m.explicit ? "said" : "inferred"}; ${m.learned_on ?? m.created_at.slice(0, 10)}) ${m.content}`;

async function askModel(env: Env, memories: Memory[]): Promise<unknown[]> {
  const res = (await env.AI!.run(CLEANUP_MODEL as any, {
    messages: [
      { role: "system", content: prompt(new Date().toISOString().slice(0, 10)) },
      { role: "user", content: memories.map(line).join("\n") }
    ],
    response_format: { type: "json_schema", json_schema: SCHEMA },
    max_tokens: 2048,
    temperature: 0
  } as any)) as { response?: unknown };
  const out = typeof res.response === "string" ? JSON.parse(res.response) : res.response;
  const list = (out as { suggestions?: unknown })?.suggestions;
  return Array.isArray(list) ? list : [];
}

/** Keeps only suggestions that point at real, distinct memories, each memory used once. */
export function validate(raw: unknown[], memories: Memory[]): Omit<Suggestion, "id" | "created_at">[] {
  const byId = new Map(memories.map((m) => [m.id, m]));
  const used = new Set<string>();
  const out: Omit<Suggestion, "id" | "created_at">[] = [];
  for (const r of raw as { kind?: unknown; ids?: unknown; content?: unknown; reason?: unknown }[]) {
    if (out.length >= MAX_SUGGESTIONS) break;
    if (!r || !Array.isArray(r.ids) || typeof r.reason !== "string" || !r.reason.trim()) continue;
    const ids = [...new Set(r.ids.filter((i): i is string => typeof i === "string"))];
    if (ids.length === 0 || ids.some((i) => !byId.has(i) || used.has(i))) continue;
    const reason = r.reason.trim().slice(0, 200);
    if (r.kind === "merge") {
      const content = typeof r.content === "string" ? r.content.trim() : "";
      if (ids.length < 2 || content.length < 3 || content.length > 500) continue;
      out.push({ kind: "merge", memory_ids: ids, content, reason });
    } else if (r.kind === "forget") {
      if (ids.length !== 1 || byId.get(ids[0])!.category === "instructions") continue;
      out.push({ kind: "forget", memory_ids: ids, content: null, reason });
    } else continue;
    ids.forEach((i) => used.add(i));
  }
  return out;
}

/** Runs a cleanup pass for one account, replacing its pending suggestions. Returns how many it found. */
export async function cleanupUser(env: Env, userId: string): Promise<number> {
  const db = env.DB;
  await db.prepare(`UPDATE users SET cleanup_at = ${NOW_SQL} WHERE id = ?`).bind(userId).run();
  const memories = await listActive(db, userId);
  if (memories.length < 2 || !env.AI) return 0;
  // Dismissed suggestions aren't offered again for the same memories.
  const { results: dismissed } = await db
    .prepare(`SELECT memory_ids FROM cleanup_suggestions WHERE user_id = ? AND status = 'dismissed'`)
    .bind(userId)
    .all<{ memory_ids: string }>();
  const seen = new Set(dismissed.map((d) => JSON.parse(d.memory_ids).sort().join(",")));

  const found: Omit<Suggestion, "id" | "created_at">[] = [];
  let answered = 0;
  // listActive groups by category, so related memories mostly land in the same chunk.
  for (let i = 0; i < memories.length && i / CHUNK < MAX_CHUNKS; i += CHUNK) {
    const chunk = memories.slice(i, i + CHUNK);
    try {
      found.push(...validate(await askModel(env, chunk), chunk));
      answered++;
    } catch (e) {
      console.error("cleanup model call failed", e);
    }
  }
  // If the model never answered, keep whatever was already waiting for review.
  if (answered === 0) return 0;
  const fresh = found.filter((s) => !seen.has([...s.memory_ids].sort().join(","))).slice(0, MAX_SUGGESTIONS);
  const ts = new Date().toISOString();
  await db.batch([
    db.prepare(`DELETE FROM cleanup_suggestions WHERE user_id = ? AND status = 'pending'`).bind(userId),
    ...fresh.map((s) =>
      db
        .prepare(`INSERT INTO cleanup_suggestions (id, user_id, kind, memory_ids, content, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(newId(), userId, s.kind, JSON.stringify(s.memory_ids), s.content, s.reason, ts)
    )
  ]);
  const auto = await db.prepare(`SELECT cleanup_auto FROM users WHERE id = ?`).bind(userId).first<{ cleanup_auto: number }>();
  if (auto?.cleanup_auto) {
    for (const s of await pendingSuggestions(db, userId)) if (s.kind === "merge") await applySuggestion(db, userId, s.id);
  }
  return fresh.length;
}

/** Hourly cron: Pro accounts whose last pass is a week old (or never ran), a few at a time. */
export async function runCleanups(env: Env): Promise<void> {
  if (!env.AI) return;
  const { results } = await env.DB.prepare(
    `SELECT id FROM users WHERE ${PLAN_SQL} = 'pro'
       AND (cleanup_at IS NULL OR cleanup_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${EVERY_DAYS} days'))
       AND (SELECT COUNT(*) FROM memories m WHERE m.user_id = users.id AND m.status = 'active') >= 2
     ORDER BY cleanup_at IS NOT NULL, cleanup_at LIMIT ?`
  )
    .bind(USERS_PER_RUN)
    .all<{ id: string }>();
  for (const { id } of results) {
    try {
      await cleanupUser(env, id);
    } catch (e) {
      console.error("cleanup failed for an account", e);
    }
  }
}

export async function pendingSuggestions(db: D1Database, userId: string): Promise<SuggestionView[]> {
  const [{ results }, memories] = await Promise.all([
    db
      .prepare(`SELECT id, kind, memory_ids, content, reason, created_at FROM cleanup_suggestions WHERE user_id = ? AND status = 'pending' ORDER BY kind, created_at`)
      .bind(userId)
      .all<Omit<Suggestion, "memory_ids"> & { memory_ids: string }>(),
    listActive(db, userId)
  ]);
  const byId = new Map(memories.map((m) => [m.id, m]));
  // A memory that changed since the pass makes its suggestion out of date; it's just not shown.
  return results
    .map((r) => ({ ...r, memory_ids: JSON.parse(r.memory_ids) as string[] }))
    .filter((r) => r.memory_ids.every((id) => byId.has(id)))
    .map((r) => ({ ...r, memories: r.memory_ids.map((id) => byId.get(id)!) }));
}

export async function countPending(db: D1Database, userId: string): Promise<number> {
  return (await pendingSuggestions(db, userId)).length;
}

/** Applies one pending suggestion. False if it no longer applies (the memories changed). */
export async function applySuggestion(db: D1Database, userId: string, id: string): Promise<boolean> {
  const s = await db
    .prepare(`SELECT kind, memory_ids, content FROM cleanup_suggestions WHERE id = ? AND user_id = ? AND status = 'pending'`)
    .bind(id, userId)
    .first<{ kind: Suggestion["kind"]; memory_ids: string; content: string | null }>();
  if (!s) return false;
  const ids = JSON.parse(s.memory_ids) as string[];
  let ok = false;
  if (s.kind === "merge" && s.content) {
    if ((await writeAllowance(db, userId, { addsActive: false })).left < 1) return false;
    ok = !!(await mergeMemories(db, userId, ids, { content: s.content }, CLEANUP_EDITOR));
  } else if (s.kind === "forget") {
    ok = await forgetMemory(db, userId, ids[0]);
  }
  await resolve(db, userId, id, ok ? "applied" : "dismissed");
  return ok;
}

export async function dismissSuggestion(db: D1Database, userId: string, id: string): Promise<void> {
  await resolve(db, userId, id, "dismissed");
}

async function resolve(db: D1Database, userId: string, id: string, status: "applied" | "dismissed") {
  await db
    .prepare(`UPDATE cleanup_suggestions SET status = ?, resolved_at = ${NOW_SQL} WHERE id = ? AND user_id = ? AND status = 'pending'`)
    .bind(status, id, userId)
    .run();
}

export async function cleanupSettings(db: D1Database, userId: string): Promise<{ auto: boolean; lastRun: string | null }> {
  const row = await db.prepare(`SELECT cleanup_auto, cleanup_at FROM users WHERE id = ?`).bind(userId).first<{ cleanup_auto: number; cleanup_at: string | null }>();
  return { auto: !!row?.cleanup_auto, lastRun: row?.cleanup_at ?? null };
}

export async function setCleanupAuto(db: D1Database, userId: string, auto: boolean): Promise<void> {
  await db.prepare(`UPDATE users SET cleanup_auto = ? WHERE id = ?`).bind(auto ? 1 : 0, userId).run();
}
