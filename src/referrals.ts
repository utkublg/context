// "Invite a friend, you both get a month of Pro." The invite link (/r/<code>) leaves a cookie,
// sign-up records who invited the new user, and the reward is given when the new user approves
// their first AI app: a bare sign-up is too easy to fake with throwaway Google accounts.
import { NOW_SQL } from "./memories";

export const REFERRAL_DAYS = 30;
/** Rewards an inviter can earn, so a farm of fake accounts buys at most a year. */
export const MAX_REFERRAL_REWARDS = 12;

export const REFERRAL_CODE = /^[0-9a-f]{10}$/;

export function newReferralCode(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Someone paying for Pro banks the days instead (they start when the subscription ends, see
// syncSubscription), so the reward isn't spent while they're paying anyway. Otherwise the days
// extend any free Pro they already have, and history is kept for 30 days after it runs out.
// SQLite evaluates every SET expression against the old row, so pro_until below is the old value.
const grant = (db: D1Database, userId: string) =>
  db
    .prepare(
      `UPDATE users SET
         bonus_days = bonus_days + CASE WHEN plan = 'pro' THEN ?2 ELSE 0 END,
         pro_until = CASE WHEN plan = 'pro' THEN pro_until
           ELSE strftime('%Y-%m-%dT%H:%M:%fZ', MAX(${NOW_SQL}, COALESCE(pro_until, '')), '+' || ?2 || ' days') END,
         history_until = CASE WHEN plan = 'pro' THEN history_until
           ELSE strftime('%Y-%m-%dT%H:%M:%fZ', MAX(${NOW_SQL}, COALESCE(pro_until, '')), '+' || (?2 + 30) || ' days') END
       WHERE id = ?1`
    )
    .bind(userId, REFERRAL_DAYS);

/** Called when a user approves an AI app. Rewards them and their inviter, once. */
export async function rewardReferral(db: D1Database, userId: string): Promise<void> {
  // Claiming the reward and reading the inviter in one statement means two approvals racing
  // each other can't both reward.
  const row = await db
    .prepare(
      `UPDATE users SET referral_rewarded_at = ${NOW_SQL}
       WHERE id = ? AND referred_by IS NOT NULL AND referral_rewarded_at IS NULL
       RETURNING referred_by`
    )
    .bind(userId)
    .first<{ referred_by: string }>();
  if (!row) return;
  const rewarded = await db
    .prepare(`SELECT COUNT(*) AS n FROM users WHERE referred_by = ? AND referral_rewarded_at IS NOT NULL`)
    .bind(row.referred_by)
    .first<{ n: number }>();
  const inviterEarns = (rewarded?.n ?? 0) <= MAX_REFERRAL_REWARDS;
  await db.batch(inviterEarns ? [grant(db, userId), grant(db, row.referred_by)] : [grant(db, userId)]);
}

export interface ReferralStats {
  code: string;
  /** Friends who signed up with the link. */
  joined: number;
  /** Of those, friends who connected an AI app, earning the inviter a month. */
  rewarded: number;
}

export async function referralStats(db: D1Database, userId: string): Promise<ReferralStats> {
  const row = await db
    .prepare(
      `SELECT u.referral_code AS code,
              (SELECT COUNT(*) FROM users f WHERE f.referred_by = u.id) AS joined,
              (SELECT COUNT(*) FROM users f WHERE f.referred_by = u.id AND f.referral_rewarded_at IS NOT NULL) AS rewarded
       FROM users u WHERE u.id = ?`
    )
    .bind(userId)
    .first<ReferralStats>();
  return row!;
}

/** The user's invite code. Accounts created before referrals, or while the migration was rolling out, get one here. */
export async function referralCode(db: D1Database, userId: string): Promise<string> {
  const row = await db.prepare(`SELECT referral_code AS code FROM users WHERE id = ?`).bind(userId).first<{ code: string | null }>();
  if (row?.code) return row.code;
  const code = newReferralCode();
  await db.prepare(`UPDATE users SET referral_code = ? WHERE id = ? AND referral_code IS NULL`).bind(code, userId).run();
  return (await db.prepare(`SELECT referral_code AS code FROM users WHERE id = ?`).bind(userId).first<{ code: string }>())!.code;
}
