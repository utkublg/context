export const CATEGORIES = [
  "instructions",
  "about_me",
  "preferences",
  "projects",
  "people",
  "goals",
  "decisions",
  "current"
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  instructions: "Instructions",
  about_me: "About me",
  preferences: "Preferences",
  projects: "Projects",
  people: "People",
  goals: "Goals",
  decisions: "Decisions",
  current: "Current context"
};

export interface Memory {
  id: string;
  user_id: string;
  content: string;
  category: Category;
  source: string;
  explicit: number;
  confidence: number;
  status: "active" | "superseded" | "forgotten";
  supersedes_id: string | null;
  superseded_by?: string | null;
  /** Who last changed it; null if it's unchanged since it was learned. */
  edited_by?: string | null;
  /** When the fact was originally learned (YYYY-MM-DD), if known — e.g. from an import. */
  learned_on?: string | null;
  /** The embedding model of this memory's vector in Vectorize (Pro semantic search); null if none. */
  embedded_with?: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewMemory {
  content: string;
  category: Category;
  explicit: boolean;
  confidence?: number;
  /** YYYY-MM-DD the fact was originally learned, if the source knows it. */
  learned_on?: string | null;
}

// Short ids keep tool responses cheap in tokens; 10 base36 chars is plenty for per-user uniqueness.
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

const now = () => new Date().toISOString();

// --- Sessions -----------------------------------------------------------------
// session.ts stays DB-free, so the caller (web.ts) fetches/bumps this to check and
// revoke already-issued session cookies.

/** null when the user no longer exists (deleted account), so their old cookies stop working too. */
export async function getSessionVersion(db: D1Database, userId: string): Promise<number | null> {
  const row = await db
    .prepare(`SELECT session_version FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ session_version: number }>();
  return row ? row.session_version : null;
}

// --- Plans and limits -----------------------------------------------------------
// Memories are cheap to store, so both plans are "unlimited" for personal use; Pro sells
// history, not space. The caps are a fair-use backstop against scripts and runaway assistants,
// far above what a person builds up. Pro keeps every old version, so its total cap (history
// included) stops an assistant stuck in an update loop from growing an account without bound.

export type Plan = "free" | "pro";
export const MAX_ACTIVE = 10_000;
export const MAX_TOTAL_ROWS = 30_000;

export const NOW_SQL = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;
/** The plan a user gets: paid Pro, or free Pro earned from referrals (pro_until). */
export const PLAN_SQL = `CASE WHEN plan = 'pro' OR pro_until > ${NOW_SQL} THEN 'pro' ELSE 'free' END`;

export async function getPlan(db: D1Database, userId: string): Promise<Plan> {
  const row = await db.prepare(`SELECT ${PLAN_SQL} AS plan FROM users WHERE id = ?`).bind(userId).first<{ plan: Plan }>();
  return row?.plan ?? "free";
}

/** How many new rows this user may write right now. Updates and merges replace active memories
 *  rather than adding them, so they pass addsActive: false and only the total cap applies. */
export async function writeAllowance(
  db: D1Database,
  userId: string,
  opts = { addsActive: true }
): Promise<{ left: number; plan: Plan }> {
  const row = await db
    .prepare(
      `SELECT (SELECT ${PLAN_SQL} FROM users WHERE id = ?1) AS plan, SUM(status = 'active') AS active, COUNT(*) AS total
       FROM memories WHERE user_id = ?1`
    )
    .bind(userId)
    .first<{ plan: Plan | null; active: number | null; total: number }>();
  const plan = row?.plan ?? "free";
  const byTotal = MAX_TOTAL_ROWS - (row?.total ?? 0);
  const byActive = opts.addsActive ? MAX_ACTIVE - (row?.active ?? 0) : Infinity;
  return { left: Math.max(0, Math.min(byActive, byTotal)), plan };
}

export function limitMessage(plan: Plan): string {
  const cap =
    plan === "pro"
      ? `${MAX_ACTIVE.toLocaleString("en")} memories, or ${MAX_TOTAL_ROWS.toLocaleString("en")} including edit history`
      : `${MAX_ACTIVE.toLocaleString("en")} memories`;
  return `Context limit reached: fair use allows up to ${cap} per account. Merge or forget memories that are no longer useful, or delete old ones on the Context website.`;
}

/** Permanently deletes the user and every memory they have, including history. */
export async function deleteUserData(db: D1Database, userId: string): Promise<void> {
  // One statement removes rows that point at each other, so the self-referencing keys never dangle.
  await db.batch([
    tombstone(db, `user_id = ?`, [userId]),
    db.prepare(`DELETE FROM memories WHERE user_id = ?`).bind(userId),
    db.prepare(`DELETE FROM user_apps WHERE user_id = ?`).bind(userId),
    db.prepare(`DELETE FROM api_keys WHERE user_id = ?`).bind(userId),
    db.prepare(`DELETE FROM cleanup_suggestions WHERE user_id = ?`).bind(userId),
    db.prepare(`DELETE FROM backups WHERE user_id = ?`).bind(userId),
    db.prepare(`DELETE FROM users WHERE id = ?`).bind(userId)
  ]);
}

export async function bumpSessionVersion(db: D1Database, userId: string): Promise<void> {
  await db.prepare(`UPDATE users SET session_version = session_version + 1 WHERE id = ?`).bind(userId).run();
}

export async function listActive(db: D1Database, userId: string, category?: Category): Promise<Memory[]> {
  const sql = `SELECT * FROM memories WHERE user_id = ? AND status = 'active'
    ${category ? "AND category = ?" : ""}
    ORDER BY category, explicit DESC, updated_at DESC`;
  const stmt = category ? db.prepare(sql).bind(userId, category) : db.prepare(sql).bind(userId);
  return (await stmt.all<Memory>()).results;
}

export async function getActive(db: D1Database, userId: string, id: string): Promise<Memory | null> {
  return db
    .prepare(`SELECT * FROM memories WHERE id = ? AND user_id = ? AND status = 'active'`)
    .bind(id, userId)
    .first<Memory>();
}

export async function insertMemories(
  db: D1Database,
  userId: string,
  items: NewMemory[],
  source: string
): Promise<Memory[]> {
  if (items.length === 0) return [];
  const ts = now();
  const rows: Memory[] = items.map((m) => ({
    id: newId(),
    user_id: userId,
    content: m.content.trim(),
    category: m.category,
    source,
    explicit: m.explicit ? 1 : 0,
    confidence: m.confidence ?? (m.explicit ? 0.95 : 0.6),
    status: "active",
    supersedes_id: null,
    learned_on: m.learned_on ?? null,
    created_at: ts,
    updated_at: ts
  }));
  // Large imports go in batches of 500 so no single database call gets too big.
  for (let i = 0; i < rows.length; i += 500) {
    await db.batch(rows.slice(i, i + 500).map(insertStmt(db)));
  }
  return rows;
}

/** Joins sources into one sorted label, e.g. ["Claude", "ChatGPT + Claude"] -> "ChatGPT + Claude". */
export function combineSources(sources: string[]): string {
  return [...new Set(sources.flatMap((s) => s.split(" + ")))].sort().join(" + ").slice(0, 80);
}

// Free accounts delete for real. Rows that still point at the deleted ones (leftover history
// from before plans, or a lapsed Pro subscription) are unlinked first so the foreign keys hold.
// Queues the vectors of memories about to be deleted, so the daily cron removes them from
// Vectorize too (see pruneVectors in semantic.ts).
function tombstone(db: D1Database, where: string, args: unknown[]): D1PreparedStatement {
  return db
    .prepare(`INSERT OR IGNORE INTO vector_tombstones (id) SELECT id FROM memories WHERE embedded_with IS NOT NULL AND ${where}`)
    .bind(...args);
}

function hardDelete(db: D1Database, userId: string, ids: string[]): D1PreparedStatement[] {
  const ph = ids.map(() => "?").join(", ");
  return [
    tombstone(db, `user_id = ? AND status = 'active' AND id IN (${ph})`, [userId, ...ids]),
    db.prepare(`UPDATE memories SET supersedes_id = NULL WHERE user_id = ? AND supersedes_id IN (${ph})`).bind(userId, ...ids),
    db.prepare(`UPDATE memories SET superseded_by = NULL WHERE user_id = ? AND superseded_by IN (${ph})`).bind(userId, ...ids),
    db.prepare(`DELETE FROM memories WHERE user_id = ? AND status = 'active' AND id IN (${ph})`).bind(userId, ...ids)
  ];
}

/** Replaces a memory with a new version. Pro keeps the old one as superseded history; free
 *  overwrites it in place, keeping its id. The source is kept either way. */
export async function updateMemory(
  db: D1Database,
  userId: string,
  id: string,
  patch: Partial<NewMemory>,
  editor: string
): Promise<Memory | null> {
  const old = await getActive(db, userId, id);
  if (!old) return null;
  const ts = now();
  const explicit = patch.explicit ?? old.explicit === 1;
  const fields = {
    content: patch.content?.trim() ?? old.content,
    category: patch.category ?? old.category,
    edited_by: editor,
    explicit: explicit ? 1 : 0,
    confidence: patch.confidence ?? (explicit ? 0.95 : old.confidence),
    updated_at: ts
  };
  if ((await getPlan(db, userId)) === "free") {
    const res = await db
      .prepare(
        `UPDATE memories SET content = ?, category = ?, edited_by = ?, explicit = ?, confidence = ?, updated_at = ?, embedded_with = NULL
         WHERE id = ? AND user_id = ? AND status = 'active'`
      )
      .bind(fields.content, fields.category, fields.edited_by, fields.explicit, fields.confidence, ts, old.id, userId)
      .run();
    return res.meta.changes > 0 ? { ...old, ...fields } : null;
  }
  const next: Memory = { ...old, ...fields, id: newId(), status: "active", supersedes_id: old.id, created_at: ts };
  // Insert first: superseded_by is a foreign key to the new row.
  const batchResult = await db.batch([
    insertStmt(db)(next),
    db
      .prepare(
        `UPDATE memories SET status = 'superseded', superseded_by = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = 'active'`
      )
      .bind(next.id, ts, old.id, userId)
  ]);
  if (batchResult[1].meta.changes === 0) {
    // Lost a race: the row was no longer active by the time this update ran. Undo the
    // insert so we don't leave an orphaned duplicate, and report failure like the `old` check above.
    await db.prepare(`DELETE FROM memories WHERE id = ?`).bind(next.id).run();
    return null;
  }
  return next;
}

/**
 * Collapses several memories that say the same thing into one new memory. All-or-nothing:
 * returns null without changing anything if any id isn't an active memory of this user.
 * Pro keeps the originals as superseded history; free deletes them.
 */
export async function mergeMemories(
  db: D1Database,
  userId: string,
  ids: string[],
  merged: { content: string; category?: Category; explicit?: boolean },
  editor: string
): Promise<{ memory: Memory; replaced: Memory[] } | null> {
  const unique = [...new Set(ids)];
  const placeholders = unique.map(() => "?").join(", ");
  const { results: olds } = await db
    .prepare(`SELECT * FROM memories WHERE user_id = ? AND status = 'active' AND id IN (${placeholders})`)
    .bind(userId, ...unique)
    .all<Memory>();
  if (olds.length !== unique.length) return null;
  // Keep the order the caller gave, so the first id decides the default category.
  olds.sort((a, b) => unique.indexOf(a.id) - unique.indexOf(b.id));

  const ts = now();
  const keepHistory = (await getPlan(db, userId)) === "pro";
  // If the user ever stated any of these, the merged fact counts as stated.
  const explicit = merged.explicit ?? olds.some((m) => m.explicit === 1);
  const memory: Memory = {
    id: newId(),
    user_id: userId,
    content: merged.content.trim(),
    category: merged.category ?? olds[0].category,
    // Every assistant that learned this fact independently, which also hints it's reliable.
    source: combineSources(olds.map((m) => m.source)),
    edited_by: editor,
    explicit: explicit ? 1 : 0,
    confidence: explicit ? 0.95 : Math.max(...olds.map((m) => m.confidence)),
    status: "active",
    supersedes_id: keepHistory ? olds[0].id : null,
    // The fact has been known since the earliest of its originals.
    learned_on: olds.map((m) => m.learned_on).filter((d): d is string => !!d).sort()[0] ?? null,
    created_at: ts,
    updated_at: ts
  };
  if (!keepHistory) {
    await db.batch([insertStmt(db)(memory), ...hardDelete(db, userId, unique)]);
    return { memory, replaced: olds };
  }
  // Insert first: superseded_by is a foreign key to the new row.
  await db.batch([
    insertStmt(db)(memory),
    db
      .prepare(
        `UPDATE memories SET status = 'superseded', superseded_by = ?, updated_at = ?
         WHERE user_id = ? AND status = 'active' AND id IN (${placeholders})`
      )
      .bind(memory.id, ts, userId, ...unique)
  ]);
  return { memory, replaced: olds };
}

/** Pro moves the memory to its forgotten history, where it can be restored; free deletes it. */
export async function forgetMemory(db: D1Database, userId: string, id: string): Promise<boolean> {
  if ((await getPlan(db, userId)) === "free") {
    const res = await db.batch(hardDelete(db, userId, [id]));
    return res[3].meta.changes > 0;
  }
  const res = await db
    .prepare(`UPDATE memories SET status = 'forgotten', updated_at = ? WHERE id = ? AND user_id = ? AND status = 'active'`)
    .bind(now(), id, userId)
    .run();
  return res.meta.changes > 0;
}

// --- History (Pro) -------------------------------------------------------------

export interface HistoryEntry extends Memory {
  /** What a superseded memory became, and how many memories went into it (more than one = merged). */
  next_content: string | null;
  next_category: Memory["category"] | null;
  next_explicit: number | null;
  next_edited_by: string | null;
  next_status: Memory["status"] | null;
  next_sources: number;
}

export async function listHistory(db: D1Database, userId: string, limit = 300): Promise<HistoryEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT h.*, n.content AS next_content, n.category AS next_category, n.explicit AS next_explicit,
              n.edited_by AS next_edited_by, n.status AS next_status,
              (SELECT COUNT(*) FROM memories p WHERE p.superseded_by = h.superseded_by) AS next_sources
       FROM memories h LEFT JOIN memories n ON n.id = h.superseded_by
       WHERE h.user_id = ? AND h.status != 'active'
       ORDER BY h.updated_at DESC LIMIT ?`
    )
    .bind(userId, limit)
    .all<HistoryEntry>();
  return results;
}

/**
 * Brings back an old version or a forgotten memory. A forgotten memory becomes active again.
 * An old version replaces the current version it led to (as a new edit, so nothing is lost),
 * unless that was a merge or is gone, in which case it comes back as a memory of its own.
 */
export async function restoreMemory(
  db: D1Database,
  userId: string,
  id: string
): Promise<{ restored: Memory; how: "reactivated" | "replaced" | "copied" } | "limit" | null> {
  const old = await db
    .prepare(`SELECT * FROM memories WHERE id = ? AND user_id = ? AND status != 'active'`)
    .bind(id, userId)
    .first<Memory>();
  if (!old) return null;

  // Follow the chain of edits to the version that's current now, if any. A merge anywhere
  // along the way means the current version holds other facts too, so it isn't replaced.
  let head: Memory | null = null;
  let merged = false;
  let cursor = old.superseded_by ?? null;
  for (let hops = 0; cursor && hops < 100; hops++) {
    const row: (Memory & { parts: number }) | null = await db
      .prepare(
        `SELECT m.*, (SELECT COUNT(*) FROM memories p WHERE p.superseded_by = m.id) AS parts
         FROM memories m WHERE m.id = ? AND m.user_id = ?`
      )
      .bind(cursor, userId)
      .first<Memory & { parts: number }>();
    if (!row) break;
    if (row.parts > 1) merged = true;
    if (row.status === "active") head = row;
    cursor = row.superseded_by ?? null;
  }
  if (head && !merged) {
    if ((await writeAllowance(db, userId, { addsActive: false })).left < 1) return "limit";
    const updated = await updateMemory(
      db,
      userId,
      head.id,
      { content: old.content, category: old.category, explicit: old.explicit === 1 },
      "You"
    );
    return updated ? { restored: updated, how: "replaced" } : null;
  }

  if ((await writeAllowance(db, userId)).left < 1) return "limit";
  if (old.status === "forgotten") {
    const res = await db
      .prepare(`UPDATE memories SET status = 'active', updated_at = ? WHERE id = ? AND user_id = ? AND status = 'forgotten'`)
      .bind(now(), id, userId)
      .run();
    return res.meta.changes > 0 ? { restored: { ...old, status: "active" }, how: "reactivated" } : null;
  }
  const [copy] = await insertMemories(
    db,
    userId,
    [{ content: old.content, category: old.category, explicit: old.explicit === 1, confidence: old.confidence, learned_on: old.learned_on }],
    old.source
  );
  return { restored: copy, how: "copied" };
}

/**
 * Daily cron: deletes the history of free accounts whose grace period is over (accounts from
 * before plans, and lapsed Pro subscriptions get 30 days). Active memories are never touched.
 */
export async function purgeExpiredHistory(db: D1Database): Promise<void> {
  const expired = `SELECT id FROM users WHERE ${PLAN_SQL} = 'free' AND history_until IS NOT NULL AND history_until < ?`;
  const ts = now();
  // Active rows may point back at old versions, so unlink them before deleting.
  await db.batch([
    tombstone(db, `status != 'active' AND user_id IN (${expired})`, [ts]),
    db.prepare(`UPDATE memories SET supersedes_id = NULL WHERE status = 'active' AND supersedes_id IS NOT NULL AND user_id IN (${expired})`).bind(ts),
    db.prepare(`DELETE FROM memories WHERE status != 'active' AND user_id IN (${expired})`).bind(ts),
    db.prepare(`UPDATE users SET history_until = NULL WHERE id IN (${expired})`).bind(ts)
  ]);
}

/** The user vouches for an AI-inferred memory, turning it into an explicit fact. */
export async function confirmMemory(db: D1Database, userId: string, id: string): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE memories SET explicit = 1, confidence = 0.95, updated_at = ? WHERE id = ? AND user_id = ? AND status = 'active'`
    )
    .bind(now(), id, userId)
    .run();
  return res.meta.changes > 0;
}

const insertStmt = (db: D1Database) => (m: Memory) =>
  db
    .prepare(
      `INSERT INTO memories (id, user_id, content, category, source, edited_by, explicit, confidence, status, supersedes_id, learned_on, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      m.id,
      m.user_id,
      m.content,
      m.category,
      m.source,
      m.edited_by ?? null,
      m.explicit,
      m.confidence,
      m.status,
      m.supersedes_id,
      m.learned_on ?? null,
      m.created_at,
      m.updated_at
    );

// --- Search -----------------------------------------------------------------
// Deliberately simple keyword scoring done in the Worker. A single user has a few
// hundred memories, so scanning them costs ~1ms and no extra infrastructure.
// Swap this for embeddings only if real usage shows it missing relevant memories.

const STOPWORDS = new Set(
  "a an and are as at be but by do does for from has have how i i'm in is it its me my of on or our should so that the their them this to was we what when where which who why will with you your".split(
    " "
  )
);

function terms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map(stem);
}

// Crude suffix stripping so "decided"/"decision"/"decides" and "flights"/"flight" meet.
function stem(w: string): string {
  return w.replace(/(ations?|ions?|ings?|ed|es|s|ly)$/, "").slice(0, 8) || w;
}

/** The web UI's search box: every word must appear somewhere in the memory, as a substring
 *  so partial words work while typing ("bould" finds "bouldering"). Keeps the input order. */
export function filterMemories(memories: Memory[], query: string): Memory[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return memories;
  return memories.filter((m) => {
    const haystack = `${m.content} ${CATEGORY_LABELS[m.category]} ${m.source}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

export function searchMemories(memories: Memory[], query: string, limit: number): Memory[] {
  const q = new Set(terms(query));
  if (q.size === 0) return [];
  return memories
    .map((m) => {
      const words = new Set(terms(`${m.content} ${CATEGORY_LABELS[m.category]}`));
      let hits = 0;
      for (const t of q) if (words.has(t)) hits++;
      // Coverage of the query dominates; explicit facts win ties over inferences.
      const score = hits / q.size + (hits > 0 ? m.explicit * 0.05 : 0);
      return { m, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || b.m.updated_at.localeCompare(a.m.updated_at))
    .slice(0, limit)
    .map((r) => r.m);
}
