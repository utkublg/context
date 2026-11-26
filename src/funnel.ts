// Funnel tracking for the private /stats page: where new users come from, and whether they go on
// to connect an AI app, have it save a memory, and connect a second one. Only short labels are
// kept ("reddit.com", "producthunt", "invite"), never full URLs or other query parameters.
import { NOW_SQL } from "./memories";

/** First touch wins: set on a public page visit, read when the account is created. */
export const SOURCE_COOKIE = "__Host-context-src";

const clean = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, "")
    .slice(0, 40) || null;

// Referrers that are really the same site, so the source table doesn't split one channel in two.
const SITE_ALIASES: Record<string, string> = {
  "t.co": "x.com",
  "twitter.com": "x.com",
  "lnkd.in": "linkedin.com",
  "producthunt.com": "producthunt",
  "youtu.be": "youtube.com"
};

/** Where a visit came from: ?utm_source= (or ?ref= / ?via=), else the referring site. Null when neither. */
export function visitSource(url: string, referer: string | undefined, publicUrl: string): string | null {
  const params = new URL(url).searchParams;
  const tag = params.get("utm_source") ?? params.get("ref") ?? params.get("via");
  if (tag) return clean(tag);
  if (!referer) return null;
  let host: string;
  try {
    host = new URL(referer).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host || host === new URL(publicUrl).hostname) return null;
  host = host.replace(/^(www|m|mobile|old|new|out|l|lm)\./, "");
  if (host.endsWith(".reddit.com")) host = "reddit.com";
  return SITE_ALIASES[host] ?? clean(host);
}

/** Called when the user approves an AI app (or it reconnects). The first time is the "connected" step. */
export async function recordConnect(db: D1Database, userId: string, app: string): Promise<void> {
  await db
    .prepare(`INSERT INTO user_apps (user_id, app, connected_at) VALUES (?, ?, ${NOW_SQL}) ON CONFLICT DO NOTHING`)
    .bind(userId, app)
    .run();
}

/** Called on every MCP tool call. Writes at most once an hour per app, to stay well inside D1's free writes. */
export async function recordUse(db: D1Database, userId: string, app: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_apps (user_id, app, connected_at, used_at) VALUES (?, ?, ${NOW_SQL}, ${NOW_SQL})
       ON CONFLICT (user_id, app) DO UPDATE SET used_at = excluded.used_at
       WHERE used_at IS NULL OR used_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')`
    )
    .bind(userId, app)
    .run();
}

/** Called after an AI app saves memories with remember. Only the first time is kept. */
export async function recordAiSave(db: D1Database, userId: string): Promise<void> {
  await db.prepare(`UPDATE users SET first_ai_save_at = ${NOW_SQL} WHERE id = ? AND first_ai_save_at IS NULL`).bind(userId).run();
}

/** When the user connected their first AI app, or null if they haven't. */
export async function firstConnectedAt(db: D1Database, userId: string): Promise<string | null> {
  const row = await db.prepare(`SELECT MIN(connected_at) AS at FROM user_apps WHERE user_id = ?`).bind(userId).first<{ at: string | null }>();
  return row?.at ?? null;
}

export interface SourceStats {
  source: string;
  signups: number;
  last7: number;
  last30: number;
  /** Connected at least one AI app. */
  connected: number;
  /** An AI saved at least one memory. */
  saved: number;
  /** Connected two or more different AI apps. */
  twoApps: number;
  /** Used any AI app in the last 7 days. */
  active: number;
  /** Used two or more AI apps in the last 7 days. */
  active2: number;
  paid: number;
  invitePro: number;
  grantedPro: number;
}

/** One row per signup source. Two full scans (users, user_apps), fine at this size on the free plan. */
export async function funnelStats(db: D1Database): Promise<SourceStats[]> {
  const { results } = await db
    .prepare(
      `WITH a AS (
         SELECT user_id, COUNT(*) AS apps,
                SUM(used_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')) AS active_apps
         FROM user_apps GROUP BY user_id
       ),
       u AS (
         SELECT COALESCE(u.source, 'unknown') AS source, u.created_at, u.plan, u.pro_until, u.pro_granted_at,
                u.first_ai_save_at, u.referral_rewarded_at, COALESCE(a.apps, 0) AS apps, COALESCE(a.active_apps, 0) AS active_apps
         FROM users u LEFT JOIN a ON a.user_id = u.id
       )
       SELECT source, COUNT(*) AS signups,
              SUM(created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')) AS last7,
              SUM(created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')) AS last30,
              SUM(apps > 0 OR referral_rewarded_at IS NOT NULL) AS connected,
              SUM(first_ai_save_at IS NOT NULL) AS saved,
              SUM(apps >= 2) AS twoApps,
              SUM(active_apps >= 1) AS active,
              SUM(active_apps >= 2) AS active2,
              SUM(plan = 'pro') AS paid,
              SUM(plan != 'pro' AND pro_until > ${NOW_SQL} AND pro_granted_at IS NULL) AS invitePro,
              SUM(plan != 'pro' AND pro_until > ${NOW_SQL} AND pro_granted_at IS NOT NULL) AS grantedPro
       FROM u GROUP BY source ORDER BY signups DESC, source`
    )
    .all<SourceStats>();
  return results;
}
