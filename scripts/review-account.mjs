// TEMPORARY: makes an app-directory reviewer account for /review-login (src/review-login.ts).
// Prints a random password (give it to the reviewer) and the REVIEW_LOGINS entry (store it).
//   node scripts/review-account.mjs reviewer@example.com
import { createHash, randomBytes } from "node:crypto";

const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!/^[^\s@:,]+@[^\s@:,]+\.[^\s@:,]+$/.test(email)) {
  console.error("Usage: node scripts/review-account.mjs reviewer@example.com");
  process.exit(1);
}
const password = randomBytes(18).toString("base64url");
const hash = createHash("sha256").update(password).digest("hex");

console.log(`Email:    ${email}`);
console.log(`Password: ${password}`);
console.log(`\nREVIEW_LOGINS entry (join several with commas):\n${email}:${hash}`);
console.log(`\nProduction: npx wrangler secret put REVIEW_LOGINS   (paste the entry or entries)`);
