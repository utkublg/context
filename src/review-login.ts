// TEMPORARY: email and password sign-in for app-directory reviewers, who can't use Google
// accounts with 2-step verification. Only the accounts listed in the REVIEW_LOGINS secret can
// sign in, there's no sign-up or password reset, and nothing links here. Delete the secret to
// switch it off; delete this file and its two lines in web.ts once reviews are done.
import { Hono } from "hono";
import { html } from "hono/html";
import type { Env } from "./env";
import { getSessionVersion } from "./memories";
import { newReferralCode } from "./referrals";
import { createSessionCookie } from "./session";
import { layout } from "./views";

const reviewLogin = new Hono<{ Bindings: Env }>();

// Review accounts get their own google_sub namespace, so they can never collide with a real
// Google account, even one with the same email.
const SUB_PREFIX = "review:";

const sha256Hex = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** "email:sha256hex,email:sha256hex" → email → hash. Passwords are long and random (see
 *  scripts/review-account.mjs), so a plain SHA-256 is enough; no slow hash needed. */
function accounts(env: Env): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of (env.REVIEW_LOGINS ?? "").split(",")) {
    const i = entry.lastIndexOf(":");
    if (i > 0) map.set(entry.slice(0, i).trim().toLowerCase(), entry.slice(i + 1).trim().toLowerCase());
  }
  return map;
}

// Same rule as /login?next=: only same-site relative paths.
const safeNext = (next: string | undefined) =>
  next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/";

const page = (next: string, error?: string) =>
  layout(
    "Reviewer sign-in",
    html`<h1>Reviewer sign-in</h1>
      <p class="lead">For app-directory reviewers. Everyone else signs in with Google.</p>
      ${error ? html`<p class="warn">${error}</p>` : ""}
      <form method="post" action="/review-login" class="stack" style="max-width:420px">
        <input type="hidden" name="next" value="${next}">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="username" required>
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required>
        <div><button class="btn btn-primary">Sign in</button></div>
      </form>`
  );

// With no accounts configured, fall through to the site's normal 404 page.
reviewLogin.get("/review-login", async (c, next) => {
  if (!accounts(c.env).size) return next();
  return c.html(page(safeNext(c.req.query("next"))));
});

reviewLogin.post("/review-login", async (c, next) => {
  const list = accounts(c.env);
  if (!list.size) return next();
  const form = await c.req.parseBody();
  const email = String(form.email ?? "").trim().toLowerCase();
  const goTo = safeNext(String(form.next ?? ""));
  // Always hash, so a wrong email takes as long as a wrong password.
  const given = await sha256Hex(String(form.password ?? ""));
  const expected = list.get(email);
  if (!expected || !timingSafeEqual(given, expected)) {
    return c.html(page(goTo, "That email and password don't match."), 401);
  }

  const user = await c.env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, referral_code, source)
     VALUES (?1, ?2, ?3, ?4, 'review')
     ON CONFLICT (google_sub) DO UPDATE SET email = excluded.email
     RETURNING id`
  )
    .bind(crypto.randomUUID(), SUB_PREFIX + email, email, newReferralCode())
    .first<{ id: string }>();

  const sessionVersion = (await getSessionVersion(c.env.DB, user!.id)) ?? 0;
  c.header("Set-Cookie", await createSessionCookie(c.env.SESSION_SECRET, user!.id, sessionVersion));
  return c.redirect(goTo);
});

export default reviewLogin;
