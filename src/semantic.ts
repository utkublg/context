// Semantic search (Pro): finds memories by meaning, not just shared words, so "where should I
// eat tonight" finds "Is vegetarian". Embeddings come from Workers AI and live in Vectorize,
// keyed by memory id and tagged with the user id (a metadata index, see README).
//
// Results blend the vector matches with the keyword search everyone gets (reciprocal rank
// fusion), so an exact word match is never lost. Anything that fails falls back to keywords.
//
// Memories are embedded lazily: each search embeds the user's active memories that have no
// vector yet (new, edited, or from before Pro) and scores those locally, because Vectorize
// takes a few seconds to make fresh upserts searchable.
import type { Env } from "./env";
import { CATEGORY_LABELS, PLAN_SQL, searchMemories, type Memory } from "./memories";

export const EMBED_MODEL = "@cf/baai/bge-m3"; // multilingual, 1024 dimensions
const EMBED_BATCH = 50;
/** At most this many memories are embedded per search; the rest follow on later searches. */
const EMBED_PER_REQUEST = 300;
/** Cosine similarity below this isn't treated as a match. bge-m3 scores unrelated text around 0.3 to 0.45. */
export const MIN_SIMILARITY = 0.5;
const RRF_K = 60;

export const semanticAvailable = (env: Pick<Env, "AI" | "VECTORS">): boolean => !!env.AI && !!env.VECTORS;

const embedText = (m: Pick<Memory, "content" | "category">) => `${CATEGORY_LABELS[m.category]}: ${m.content}`;

export async function embed(env: Env, texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const res = (await env.AI!.run(EMBED_MODEL as any, { text: texts.slice(i, i + EMBED_BATCH) })) as { data?: number[][] };
    if (!res.data || res.data.length !== Math.min(EMBED_BATCH, texts.length - i)) throw new Error("Embedding failed");
    out.push(...res.data);
  }
  return out;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Embeds active memories that have no vector for the current model yet. Returns the new vectors. */
export async function embedMissing(env: Env, userId: string, memories: Memory[]): Promise<Map<string, number[]>> {
  const missing = memories.filter((m) => m.embedded_with !== EMBED_MODEL).slice(0, EMBED_PER_REQUEST);
  const fresh = new Map<string, number[]>();
  if (missing.length === 0) return fresh;
  const vectors = await embed(env, missing.map(embedText));
  missing.forEach((m, i) => fresh.set(m.id, vectors[i]));
  await env.VECTORS!.upsert(missing.map((m, i) => ({ id: m.id, values: vectors[i], metadata: { user_id: userId } })));
  // D1 takes at most 100 bound parameters per statement.
  const ids = missing.map((m) => m.id);
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    stmts.push(
      env.DB.prepare(`UPDATE memories SET embedded_with = ? WHERE user_id = ? AND id IN (${chunk.map(() => "?").join(", ")})`).bind(
        EMBED_MODEL,
        userId,
        ...chunk
      )
    );
  }
  await env.DB.batch(stmts);
  return fresh;
}

/** Memory ids with their similarity to the query, best first, above MIN_SIMILARITY. */
export async function vectorMatches(env: Env, userId: string, memories: Memory[], query: string): Promise<{ id: string; score: number }[]> {
  const [[q], fresh] = await Promise.all([embed(env, [query]), embedMissing(env, userId, memories)]);
  const res = await env.VECTORS!.query(q, { topK: 50, filter: { user_id: userId } });
  const active = new Set(memories.map((m) => m.id));
  const scores = new Map<string, number>();
  // Vectorize can still hold vectors of memories that changed since; only active ones count.
  for (const m of res.matches) if (active.has(m.id) && !fresh.has(m.id)) scores.set(m.id, m.score);
  for (const [id, v] of fresh) scores.set(id, cosine(q, v));
  return [...scores]
    .filter(([, s]) => s >= MIN_SIMILARITY)
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => ({ id, score }));
}

/** Keyword and vector results combined by reciprocal rank fusion. */
export function fuse(memories: Memory[], keyword: Memory[], vector: { id: string }[], limit: number): Memory[] {
  const byId = new Map(memories.map((m) => [m.id, m]));
  const score = new Map<string, number>();
  const add = (id: string, rank: number) => score.set(id, (score.get(id) ?? 0) + 1 / (RRF_K + rank));
  keyword.forEach((m, i) => add(m.id, i));
  vector.forEach((v, i) => add(v.id, i));
  return [...score]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => byId.get(id)!)
    .filter(Boolean);
}

/** Pro search: keywords plus meaning. Falls back to keywords alone if Workers AI or Vectorize fails. */
export async function hybridSearch(env: Env, userId: string, memories: Memory[], query: string, limit: number): Promise<Memory[]> {
  const keyword = searchMemories(memories, query, 50);
  if (!semanticAvailable(env) || memories.length === 0) return keyword.slice(0, limit);
  try {
    return fuse(memories, keyword, await vectorMatches(env, userId, memories, query), limit);
  } catch (e) {
    console.error("semantic search failed, using keywords", e);
    return keyword.slice(0, limit);
  }
}

/**
 * Daily cron. Deletes vectors that no longer belong to an active memory of a Pro account:
 * memories deleted from D1 (tombstones), old versions and forgotten memories, and everything
 * of accounts that left Pro (they get keyword search, and their deletes don't leave tombstones
 * behind once their vectors are gone).
 */
export async function pruneVectors(env: Env): Promise<void> {
  if (!env.VECTORS) return;
  for (let round = 0; round < 20; round++) {
    const tomb = (await env.DB.prepare(`SELECT id FROM vector_tombstones LIMIT 500`).all<{ id: string }>()).results.map((r) => r.id);
    const stale = (
      await env.DB.prepare(
        `SELECT id FROM memories WHERE embedded_with IS NOT NULL
           AND (status != 'active' OR user_id IN (SELECT id FROM users WHERE ${PLAN_SQL} = 'free'))
         LIMIT 500`
      ).all<{ id: string }>()
    ).results.map((r) => r.id);
    if (tomb.length === 0 && stale.length === 0) return;
    const ids = [...tomb, ...stale];
    for (let i = 0; i < ids.length; i += 500) await env.VECTORS.deleteByIds(ids.slice(i, i + 500));
    const stmts: D1PreparedStatement[] = [];
    for (let i = 0; i < tomb.length; i += 90) {
      const c = tomb.slice(i, i + 90);
      stmts.push(env.DB.prepare(`DELETE FROM vector_tombstones WHERE id IN (${c.map(() => "?").join(", ")})`).bind(...c));
    }
    for (let i = 0; i < stale.length; i += 90) {
      const c = stale.slice(i, i + 90);
      stmts.push(env.DB.prepare(`UPDATE memories SET embedded_with = NULL WHERE id IN (${c.map(() => "?").join(", ")})`).bind(...c));
    }
    await env.DB.batch(stmts);
  }
}
