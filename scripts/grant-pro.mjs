// Gives someone free Pro by hand, e.g. early users:
//   npm run grant-pro -- someone@example.com              lifetime (until 2099), production database
//   npm run grant-pro -- someone@example.com --months 6   six months on top of any free Pro they have
//   npm run grant-pro -- someone@example.com --local      the local dev database instead
//
// It sets users.pro_until the same way invite rewards do (src/referrals.ts), so the two add up:
// PLAN_SQL counts anyone with pro_until in the future as Pro, an invite reward later extends it,
// and the 12-reward invite cap only counts friends' referral_rewarded_at, which this doesn't touch.
// history_until goes to 30 days after the new end date, as for invites, so history survives the
// grace period. pro_granted_at lets /stats tell hand-given Pro apart from invite rewards.
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith("--"))?.toLowerCase();
const local = args.includes("--local");
const lifetime = args.includes("--lifetime") || !args.includes("--months");
const months = Number(args[args.indexOf("--months") + 1]);

// Strict on purpose: the email ends up inside the SQL text below.
if (!email || !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email) || (!lifetime && !(Number.isInteger(months) && months > 0 && months <= 1200))) {
  console.error("Usage: npm run grant-pro -- someone@example.com [--months N | --lifetime] [--local]");
  process.exit(1);
}

const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;
const START = `MAX(${NOW}, COALESCE(pro_until, ''))`;
const until = lifetime ? `'2099-12-31T23:59:59.000Z'` : `strftime('%Y-%m-%dT%H:%M:%fZ', ${START}, '+${months} months')`;
const historyUntil = lifetime
  ? `'2100-01-30T23:59:59.000Z'`
  : `strftime('%Y-%m-%dT%H:%M:%fZ', ${START}, '+${months} months', '+30 days')`;
// SQLite reads the old row in every SET expression, so pro_until in START is the old value.
// Like invite rewards, months given to someone paying are banked in bonus_days and start when
// their subscription ends (see syncSubscription). Lifetime applies straight away.
const paying = lifetime ? "0" : "plan = 'pro'";
const sql = `UPDATE users SET
    bonus_days = bonus_days + CASE WHEN ${paying} THEN ${lifetime ? 0 : months * 30} ELSE 0 END,
    pro_until = CASE WHEN ${paying} THEN pro_until ELSE ${until} END,
    history_until = CASE WHEN ${paying} THEN history_until ELSE ${historyUntil} END,
    pro_granted_at = ${NOW}
  WHERE email = '${email}' RETURNING email, plan, pro_until, bonus_days`;

const out = execFileSync(
  "npx",
  ["wrangler", "d1", "execute", "context-db", local ? "--local" : "--remote", "--json", "--command", sql],
  { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] }
);
const row = JSON.parse(out)[0]?.results?.[0];
if (!row) {
  console.error(`No account with the email ${email}${local ? " in the local database" : ""}. They need to sign in once first.`);
  process.exit(1);
}
const where = local ? " (local)" : "";
if (row.plan === "pro" && !lifetime) {
  console.log(`${row.email} pays through Stripe, so the time was banked: ${row.bonus_days} free days start when the subscription ends${where}.`);
} else {
  console.log(`${row.email} has Pro until ${row.pro_until.slice(0, 10)}${where}.`);
  if (row.plan === "pro") console.log("They also pay through Stripe. Cancel the subscription in Stripe if lifetime Pro should replace it.");
}
