// Personal API keys (Pro). A key works in two places:
//   - the MCP endpoint, for clients that take a header instead of OAuth (Claude Code, Cursor, ...),
//     through OAuthProvider's resolveExternalToken (see index.ts);
//   - the REST API under /api/v1 (see api.ts), for scripts and automations.
// Only a SHA-256 hash is stored. A key stops working when it's revoked or the account leaves Pro.
import { getPlan, newId } from "./memories";

export const KEY_PREFIX = "ctx_";
export const MAX_KEYS = 10;
const KEY_SHAPE = /^ctx_[A-Za-z0-9]{40}$/;

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function randomKey(): string {
  // 62 symbols; rejecting bytes >= 248 keeps every symbol equally likely (about 238 bits in all).
  const out: string[] = [];
  while (out.length < 40) {
    for (const b of crypto.getRandomValues(new Uint8Array(48))) {
      if (b < 248 && out.length < 40) out.push(ALPHABET[b % 62]);
    }
  }
  return KEY_PREFIX + out.join("");
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const looksLikeApiKey = (token: string) => KEY_SHAPE.test(token);

export async function listApiKeys(db: D1Database, userId: string): Promise<ApiKey[]> {
  const { results } = await db
    .prepare(`SELECT id, name, prefix, created_at, last_used_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`)
    .bind(userId)
    .all<ApiKey>();
  return results;
}

/** Creates a key and returns it in full. This is the only time it can be shown. */
export async function createApiKey(
  db: D1Database,
  userId: string,
  name: string
): Promise<{ key: string } | "limit" | "not-pro"> {
  if ((await getPlan(db, userId)) !== "pro") return "not-pro";
  const count = await db.prepare(`SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ?`).bind(userId).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_KEYS) return "limit";
  const key = randomKey();
  await db
    .prepare(`INSERT INTO api_keys (id, user_id, name, key_hash, prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(newId(), userId, cleanName(name), await sha256Hex(key), key.slice(0, 8), new Date().toISOString())
    .run();
  return { key };
}

export async function revokeApiKey(db: D1Database, userId: string, id: string): Promise<void> {
  await db.prepare(`DELETE FROM api_keys WHERE id = ? AND user_id = ?`).bind(id, userId).run();
}

/** Who a key belongs to, or why it can't be used. Records use at most once an hour. */
export async function resolveApiKey(
  db: D1Database,
  token: string
): Promise<{ userId: string; keyId: string; name: string } | "not-pro" | null> {
  if (!looksLikeApiKey(token)) return null;
  const row = await db
    .prepare(`SELECT id, user_id, name, last_used_at FROM api_keys WHERE key_hash = ?`)
    .bind(await sha256Hex(token))
    .first<{ id: string; user_id: string; name: string; last_used_at: string | null }>();
  if (!row) return null;
  if ((await getPlan(db, row.user_id)) !== "pro") return "not-pro";
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  if (!row.last_used_at || row.last_used_at < hourAgo) {
    await db.prepare(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`).bind(new Date().toISOString(), row.id).run();
  }
  return { userId: row.user_id, keyId: row.id, name: row.name };
}

// The name labels the memories a key saves ("Saved by Raycast"), so keep it short and plain.
export function cleanName(name: string): string {
  return name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 40) || "API";
}
