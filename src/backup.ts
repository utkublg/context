// Google Drive backups (Pro). The user connects Drive once with the drive.file scope, which only
// lets Context see the files it creates. Every day (or week), the hourly cron writes a Markdown
// and a JSON export into a "Context Backups" folder and keeps the newest KEEP_BACKUPS of each.
// The refresh token is stored encrypted with TOKEN_ENCRYPTION_KEY.
import type { Env } from "./env";
import { exportJson, exportMarkdown } from "./export";
import { getPlan, listActive, NOW_SQL, PLAN_SQL } from "./memories";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const KEEP_BACKUPS = 30;
const FOLDER_NAME = "Context Backups";
const FOLDER_MIME = "application/vnd.google-apps.folder";
/** Each backup makes about 7 requests; Workers Free allows 50 per invocation. */
const BACKUPS_PER_RUN = 5;
const DRIVE = "https://www.googleapis.com/drive/v3";
/** "Back up now" is allowed once this often (each backup is about 7 Google API calls). */
export const BACKUP_NOW_COOLDOWN_MINUTES = 5;

export type Frequency = "daily" | "weekly";

export interface BackupInfo {
  account_email: string | null;
  frequency: Frequency;
  last_backup_at: string | null;
  last_error: string | null;
  needs_reconnect: number;
}

export const backupsAvailable = (env: Pick<Env, "TOKEN_ENCRYPTION_KEY">) => (env.TOKEN_ENCRYPTION_KEY ?? "").length >= 32;
export const backupRedirectUri = (env: Pick<Env, "PUBLIC_URL">) => `${env.PUBLIC_URL}/backup/google/callback`;

// --- Token encryption (AES-GCM, key = SHA-256 of TOKEN_ENCRYPTION_KEY) ----------------

async function aesKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(secret: string, token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), new TextEncoder().encode(token)));
  const all = new Uint8Array(iv.length + ct.length);
  all.set(iv);
  all.set(ct, iv.length);
  return btoa(String.fromCharCode(...all));
}

export async function decryptToken(secret: string, stored: string): Promise<string> {
  const all = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, await aesKey(secret), all.slice(12));
  return new TextDecoder().decode(pt);
}

// --- Connection -----------------------------------------------------------------

export async function getBackup(db: D1Database, userId: string): Promise<BackupInfo | null> {
  return db
    .prepare(`SELECT account_email, frequency, last_backup_at, last_error, needs_reconnect FROM backups WHERE user_id = ?`)
    .bind(userId)
    .first<BackupInfo>();
}

/** Saves (or replaces) the Drive connection from the OAuth callback. */
export async function saveConnection(env: Env, userId: string, refreshToken: string, email: string | null): Promise<void> {
  const enc = await encryptToken(env.TOKEN_ENCRYPTION_KEY!, refreshToken);
  await env.DB.prepare(
    `INSERT INTO backups (user_id, account_email, refresh_token, created_at) VALUES (?1, ?2, ?3, ${NOW_SQL})
     ON CONFLICT (user_id) DO UPDATE SET account_email = ?2, refresh_token = ?3, needs_reconnect = 0, last_error = NULL,
       folder_id = CASE WHEN backups.account_email IS ?2 THEN backups.folder_id ELSE NULL END`
  )
    .bind(userId, email, enc)
    .run();
}

/** Minutes until "Back up now" can run again, or 0 if it can run now. */
export async function manualBackupWait(db: D1Database, userId: string): Promise<number> {
  const row = await db.prepare(`SELECT last_attempt_at FROM backups WHERE user_id = ?`).bind(userId).first<{ last_attempt_at: string | null }>();
  if (!row?.last_attempt_at) return 0;
  const left = Date.parse(row.last_attempt_at) + BACKUP_NOW_COOLDOWN_MINUTES * 60_000 - Date.now();
  return left > 0 ? Math.ceil(left / 60_000) : 0;
}

export async function setFrequency(db: D1Database, userId: string, frequency: Frequency): Promise<void> {
  await db.prepare(`UPDATE backups SET frequency = ? WHERE user_id = ?`).bind(frequency, userId).run();
}

/** Revokes Google's grant (best effort) and forgets the connection. Files already in Drive stay. */
export async function disconnect(env: Env, userId: string): Promise<void> {
  const row = await env.DB.prepare(`SELECT refresh_token FROM backups WHERE user_id = ?`).bind(userId).first<{ refresh_token: string }>();
  if (!row) return;
  if (backupsAvailable(env)) {
    try {
      const token = await decryptToken(env.TOKEN_ENCRYPTION_KEY!, row.refresh_token);
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token })
      });
    } catch (e) {
      console.error("revoking Drive token failed", e);
    }
  }
  await env.DB.prepare(`DELETE FROM backups WHERE user_id = ?`).bind(userId).run();
}

// --- Drive calls ------------------------------------------------------------------

class ReconnectNeeded extends Error {}

async function accessToken(env: Env, refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });
  const body = await res.json<{ access_token?: string; error?: string }>();
  if (body.error === "invalid_grant") throw new ReconnectNeeded();
  if (!body.access_token) throw new Error(`Google token refresh failed (${res.status})`);
  return body.access_token;
}

async function drive(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(path.startsWith("https://") ? path : `${DRIVE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers as Record<string, string>) }
  });
  if (res.status === 401 || res.status === 403) {
    const text = await res.text();
    // A 403 for a missing scope (the user unticked Drive on Google's consent page) needs a reconnect too.
    if (res.status === 401 || /insufficient|scope|permission/i.test(text)) throw new ReconnectNeeded();
    throw new Error(`Google Drive refused the request (${res.status})`);
  }
  return res;
}

async function ensureFolder(token: string, folderId: string | null): Promise<string> {
  if (folderId) {
    const res = await drive(token, `/files/${encodeURIComponent(folderId)}?fields=id,trashed`);
    if (res.ok && !(await res.json<{ trashed?: boolean }>()).trashed) return folderId;
  }
  const res = await drive(token, `/files?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME })
  });
  if (!res.ok) throw new Error(`Couldn't create the backup folder (${res.status})`);
  return (await res.json<{ id: string }>()).id;
}

async function upload(token: string, folderId: string, name: string, mime: string, content: string): Promise<void> {
  const boundary = `context${crypto.randomUUID().replace(/-/g, "")}`;
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name, parents: [folderId], mimeType: mime }) +
    `\r\n--${boundary}\r\nContent-Type: ${mime}; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`;
  const res = await drive(token, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
}

/** Deletes all but the newest KEEP_BACKUPS backups (each is a .md and a .json file). */
async function prune(token: string, folderId: string): Promise<void> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const res = await drive(token, `/files?q=${q}&orderBy=createdTime desc&pageSize=200&fields=files(id)`);
  if (!res.ok) return;
  const { files } = await res.json<{ files: { id: string }[] }>();
  for (const f of files.slice(KEEP_BACKUPS * 2, KEEP_BACKUPS * 2 + 10)) {
    await drive(token, `/files/${encodeURIComponent(f.id)}`, { method: "DELETE" });
  }
}

// --- Running backups ---------------------------------------------------------------

/** Backs up one account now. Returns an error message, or null on success. */
export async function backupUser(env: Env, userId: string): Promise<string | null> {
  if (!backupsAvailable(env)) return "Backups aren't set up on this server.";
  const db = env.DB;
  const row = await db
    .prepare(`SELECT refresh_token, folder_id FROM backups WHERE user_id = ?`)
    .bind(userId)
    .first<{ refresh_token: string; folder_id: string | null }>();
  if (!row) return "Google Drive isn't connected.";
  await db.prepare(`UPDATE backups SET last_attempt_at = ${NOW_SQL} WHERE user_id = ?`).bind(userId).run();
  if ((await getPlan(db, userId)) !== "pro") return "Backups are part of Pro.";
  try {
    const token = await accessToken(env, await decryptToken(env.TOKEN_ENCRYPTION_KEY!, row.refresh_token));
    const folderId = await ensureFolder(token, row.folder_id);
    const memories = await listActive(db, userId);
    const now = new Date().toISOString();
    const stamp = now.slice(0, 16).replace("T", " ").replace(":", ".");
    // Markdown first: it's the one people open, and it can be pasted straight into Import.
    await upload(token, folderId, `Context backup ${stamp}.md`, "text/markdown", exportMarkdown(memories, now));
    await upload(token, folderId, `Context backup ${stamp}.json`, "application/json", exportJson(memories, now));
    await prune(token, folderId);
    await db
      .prepare(`UPDATE backups SET folder_id = ?, last_backup_at = ${NOW_SQL}, last_error = NULL WHERE user_id = ?`)
      .bind(folderId, userId)
      .run();
    return null;
  } catch (e) {
    const reconnect = e instanceof ReconnectNeeded;
    const message = reconnect
      ? "Context can no longer reach your Google Drive. Connect it again to restart backups."
      : "The last backup didn't go through. Context will try again in a few hours.";
    if (!reconnect) console.error("backup failed", e);
    await db.prepare(`UPDATE backups SET last_error = ?, needs_reconnect = ? WHERE user_id = ?`).bind(message, reconnect ? 1 : 0, userId).run();
    return message;
  }
}

/** Hourly cron: Pro accounts whose backup is due. A failure waits 6 hours before the next try. */
export async function runBackups(env: Env): Promise<void> {
  if (!backupsAvailable(env)) return;
  const { results } = await env.DB.prepare(
    `SELECT b.user_id FROM backups b JOIN users u ON u.id = b.user_id
     WHERE b.needs_reconnect = 0
       AND u.id IN (SELECT id FROM users WHERE ${PLAN_SQL} = 'pro')
       AND (b.last_backup_at IS NULL OR b.last_backup_at <
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now', CASE b.frequency WHEN 'weekly' THEN '-167 hours' ELSE '-23 hours' END))
       AND (b.last_attempt_at IS NULL OR b.last_attempt_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-6 hours')
            OR b.last_attempt_at <= COALESCE(b.last_backup_at, ''))
     ORDER BY b.last_attempt_at IS NOT NULL, b.last_attempt_at LIMIT ?`
  )
    .bind(BACKUPS_PER_RUN)
    .all<{ user_id: string }>();
  for (const { user_id } of results) await backupUser(env, user_id);
}
