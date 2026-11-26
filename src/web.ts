import { Hono, type Context } from "hono";
import { AuthorizationError, CimdFetchError } from "@cloudflare/workers-oauth-provider";
import type { Env, AuthProps } from "./env";
import { sourceLabel } from "./mcp";
import { IMPORT_PROMPT, parseImport } from "./importer";
import { exportJson, exportMarkdown } from "./export";
import {
  bumpSessionVersion,
  CATEGORIES,
  confirmMemory,
  deleteUserData,
  filterMemories,
  forgetMemory,
  getActive,
  getSessionVersion,
  insertMemories,
  limitMessage,
  listActive,
  listHistory,
  restoreMemory,
  updateMemory,
  writeAllowance,
  PLAN_SQL,
  type Category,
  type Memory
} from "./memories";
import { clearSessionCookie, createSessionCookie, readSession } from "./session";
import reviewLogin from "./review-login"; // TEMPORARY: reviewer sign-in, see the file
import {
  accountDeletedPage,
  accountPage,
  cleanupPage,
  connectPage,
  consentPage,
  docsPage,
  errorPage,
  historyPage,
  importPage,
  importResultPage,
  invitePage,
  landingPage,
  memoriesPage,
  memoryCard,
  notFoundPage,
  privacyPage,
  statsPage,
  supportPage,
  termsPage,
  type Site
} from "./views";
import { ICON_SVG } from "./icon";
import { newReferralCode, referralCode, referralStats, REFERRAL_CODE, rewardReferral } from "./referrals";
import { firstConnectedAt, funnelStats, recordConnect, SOURCE_COOKIE, visitSource } from "./funnel";
import { billingEnabled, cancelSubscription, createCheckout, createPortal, syncSubscription, verifyWebhook } from "./stripe";
import { CURIOUS_PROMPT } from "./importer";
import { articleIndexPage, articlePage, setFooter, SITE_URL, whatAiKnowsPage } from "./views";
import { ARTICLES, articlePath, findArticle } from "./content";
import api from "./api";
import { createApiKey, listApiKeys, revokeApiKey } from "./apikeys";
import {
  backupRedirectUri,
  backupsAvailable,
  backupUser,
  disconnect as disconnectBackup,
  DRIVE_SCOPE,
  getBackup,
  saveConnection,
  manualBackupWait,
  setFrequency
} from "./backup";
import {
  applySuggestion,
  cleanupAvailable,
  cleanupSettings,
  cleanupUser,
  countPending,
  dismissSuggestion,
  MANUAL_COOLDOWN_MINUTES,
  pendingSuggestions,
  setCleanupAuto
} from "./cleanup";

type Ctx = Context<{ Bindings: Env; Variables: { userId: string } }>;

const app = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

// Session cookies are SameSite=Lax, so other sites can't POST with them. Checking Origin
// on every POST is a cheap second layer against cross-site form submissions.
app.use("*", async (c, next) => {
  if (c.req.method === "POST") {
    const origin = c.req.header("Origin");
    if (origin && origin !== new URL(c.env.PUBLIC_URL).origin) return c.text("Bad origin", 403);
  }
  await next();
});

// The footer names the company and links the source code on every page.
app.use("*", async (c, next) => {
  setFooter(c.env.COMPANY_NAME, c.env.SOURCE_URL);
  await next();
});

const site = (c: Ctx): Site => ({
  company: c.env.COMPANY_NAME,
  email: c.env.SUPPORT_EMAIL,
  mcpUrl: `${c.env.PUBLIC_URL}/mcp`
});

const readCookie = (c: Ctx, name: string) =>
  c.req
    .header("Cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`))
    ?.slice(name.length + 1);

// First touch: remember where a visitor came from (a link tag or the referring site) until they
// sign up (see the Google callback). Sign-in itself bounces through Google, so it's skipped.
app.use("*", async (c, next) => {
  await next();
  const path = c.req.path;
  if (c.req.method !== "GET" || path === "/login" || /^\/(auth|backup|api)\//.test(path) || readCookie(c, SOURCE_COOKIE)) return;
  const source = visitSource(c.req.url, c.req.header("Referer"), c.env.PUBLIC_URL);
  if (!source) return;
  c.res = new Response(c.res.body, c.res);
  c.res.headers.append("Set-Cookie", `${SOURCE_COOKIE}=${source}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${30 * 86400}`);
});

// REST API for personal API keys (Pro). Authenticated by the key, never by the session cookie.
app.route("/api/v1", api);

// --- Public pages (directory listings link here, so no sign-in) ----------------------

app.get("/docs", (c) => c.html(docsPage(site(c))));
app.get("/privacy", (c) => c.html(privacyPage(site(c))));
app.get("/terms", (c) => c.html(termsPage(site(c))));
app.get("/support", (c) => c.html(supportPage(site(c))));
app.get("/what-ai-knows", (c) => c.html(whatAiKnowsPage(CURIOUS_PROMPT)));

// Guides and blog posts (src/content). An unknown slug falls through to the 404 page.
app.get("/guides", (c) => c.html(articleIndexPage("guide", ARTICLES.filter((a) => a.kind === "guide"))));
app.get("/blog", (c) => c.html(articleIndexPage("post", ARTICLES.filter((a) => a.kind === "post"))));
app.get("/guides/:slug", async (c, next) => {
  const article = findArticle("guide", c.req.param("slug"));
  return article ? c.html(articlePage(article)) : next();
});
app.get("/blog/:slug", async (c, next) => {
  const article = findArticle("post", c.req.param("slug"));
  return article ? c.html(articlePage(article)) : next();
});

app.get("/sitemap.xml", (c) => {
  const day = (d: string) => `<lastmod>${d}</lastmod>`;
  const urls = [
    ...["/", "/what-ai-knows", "/guides", "/blog", "/docs", "/support", "/privacy", "/terms"].map((p) => `<url><loc>${SITE_URL}${p}</loc></url>`),
    ...ARTICLES.map((a) => `<url><loc>${SITE_URL}${articlePath(a)}</loc>${day(a.updated ?? a.published)}</url>`)
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
  return c.body(xml, 200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" });
});

app.get("/robots.txt", (c) =>
  c.text(`User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`, 200, { "Cache-Control": "public, max-age=86400" })
);
// The commit that's deployed, so anyone can check the running code against the public repo.
// scripts/deploy.sh sets GIT_COMMIT and refuses to deploy uncommitted changes.
app.get("/version", (c) => {
  const commit = c.env.GIT_COMMIT || "unknown";
  const source = c.env.SOURCE_URL
    ? { source: c.env.SOURCE_URL, tree: commit === "unknown" ? c.env.SOURCE_URL : `${c.env.SOURCE_URL}/tree/${commit}` }
    : {};
  return c.json({ commit, ...source }, 200, { "Cache-Control": "no-store" });
});

// Invite links. The code waits in a cookie until the friend signs up (see the Google callback).
const REF_COOKIE = "__Host-context-ref";
app.get("/r/:code", (c) => {
  const code = c.req.param("code").toLowerCase();
  if (REFERRAL_CODE.test(code)) {
    c.header("Set-Cookie", `${REF_COOKIE}=${code}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${30 * 86400}`);
  }
  return c.redirect("/");
});

// OpenAI's plugin dashboard proves we own the domain by fetching this token (plain text).
// Set OPENAI_APPS_CHALLENGE to the token it shows; unset, this is a normal 404.
app.get("/.well-known/openai-apps-challenge", (c, next) =>
  c.env.OPENAI_APPS_CHALLENGE ? c.text(c.env.OPENAI_APPS_CHALLENGE) : next()
);
// Google Connected Console does the same at its own path, with GOOGLE_CONNECTED_APPS_CHALLENGE.
app.get("/.well-known/google-connected-apps", (c, next) =>
  c.env.GOOGLE_CONNECTED_APPS_CHALLENGE ? c.text(c.env.GOOGLE_CONNECTED_APPS_CHALLENGE) : next()
);
// The official MCP Registry checks we own the domain (for the name com.keepyourcontext/context)
// by fetching this public key. Set MCP_REGISTRY_AUTH to the "v=MCPv1; k=ed25519; p=..." line.
app.get("/.well-known/mcp-registry-auth", (c, next) =>
  c.env.MCP_REGISTRY_AUTH ? c.text(c.env.MCP_REGISTRY_AUTH) : next()
);

app.get("/icon.svg", (c) =>
  c.body(ICON_SVG, 200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" })
);

// Stripe tells us about subscription changes here. Signed by Stripe, so no session or Origin.
// A thrown error returns 500, and Stripe retries the event later.
app.post("/stripe/webhook", async (c) => {
  if (!billingEnabled(c.env) || !c.env.STRIPE_WEBHOOK_SECRET) return c.body(null, 404);
  const body = await c.req.text();
  if (!(await verifyWebhook(c.env.STRIPE_WEBHOOK_SECRET, body, c.req.header("Stripe-Signature")))) {
    return c.text("Bad signature", 400);
  }
  const event = JSON.parse(body) as { type: string; data: { object: Record<string, any> } };
  const obj = event.data.object;
  if (event.type === "checkout.session.completed" && obj.mode === "subscription" && obj.subscription) {
    await syncSubscription(c.env, String(obj.subscription), obj.client_reference_id ?? undefined);
  } else if (event.type.startsWith("customer.subscription.")) {
    await syncSubscription(c.env, String(obj.id));
  }
  return c.body(null, 200);
});

// Looks up the signed-in user. A session whose version no longer matches the DB's
// current session_version was revoked (/logout bumps it) and is treated like a missing cookie.
async function sessionUser(c: Ctx): Promise<string | null> {
  const session = await readSession(c.env.SESSION_SECRET, c.req.raw);
  if (!session) return null;
  const current = await getSessionVersion(c.env.DB, session.userId);
  return session.sessionVersion === current ? session.userId : null;
}

// --- Google sign-in ------------------------------------------------------------

const LOGIN_COOKIE = "__Host-context-login";

// Only same-site relative paths, so /login?next= can't bounce users to another site.
// Backslashes are rejected too: browsers normalize a leading "/\" to "//" for http(s) URLs,
// which would otherwise let "/\evil.com" slip past the "//" check above and redirect off-site.
const safeNext = (next: string | undefined) =>
  next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/";

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

app.get("/login", async (c) => {
  const state = crypto.randomUUID();
  // PKCE: the code Google returns is useless without this verifier, which never leaves our cookie.
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const next = safeNext(c.req.query("next"));

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", c.env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", `${c.env.PUBLIC_URL}/auth/google/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  c.header(
    "Set-Cookie",
    `${LOGIN_COOKIE}=${state}|${verifier}|${encodeURIComponent(next)}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=600`
  );
  return c.redirect(url.toString());
});

interface GoogleIdToken {
  iss: string;
  aud: string;
  sub: string;
  email?: string;
  email_verified?: boolean;
  exp: number;
}

app.get("/auth/google/callback", async (c) => {
  const cookie = readCookie(c, LOGIN_COOKIE);
  const [expectedState, verifier, encodedNext] = cookie?.split("|") ?? [];
  const code = c.req.query("code");
  if (!code || !expectedState || !verifier || c.req.query("state") !== expectedState) {
    return c.html(errorPage("Sign-in expired or was started in another browser. Please try again."), 400);
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: `${c.env.PUBLIC_URL}/auth/google/callback`
    })
  });
  const { id_token } = await tokenRes.json<{ id_token?: string }>();
  if (!id_token) return c.html(errorPage("Google sign-in failed."), 400);

  // The ID token came straight from Google's token endpoint over TLS, authenticated with our
  // client secret, so OpenID Connect allows trusting it without re-checking the signature.
  // We still check it was issued to us, by Google, and hasn't expired.
  const claims = JSON.parse(
    atob(id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
  ) as GoogleIdToken;
  const validIssuer = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  if (!validIssuer || claims.aud !== c.env.GOOGLE_CLIENT_ID || claims.exp < Date.now() / 1000) {
    return c.html(errorPage("Google sign-in could not be verified."), 400);
  }
  if (!claims.email || !claims.email_verified) {
    return c.html(landingPage(site(c), "Your Google account needs a verified email address."), 403);
  }

  const email = claims.email.toLowerCase();
  if (c.env.OPEN_SIGNUP !== "true") {
    const allowed = (c.env.ALLOWED_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (!allowed.includes(email)) {
      return c.html(landingPage(site(c), `${email} isn't on this Context's allowlist yet.`), 403);
    }
  }

  // A new account records who invited it and where it came from (an existing one keeps its own).
  const ref = readCookie(c, REF_COOKIE) ?? "";
  const source = readCookie(c, SOURCE_COOKIE);
  const user = await c.env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, referral_code, referred_by, source)
     VALUES (?1, ?2, ?3, ?4, (SELECT id FROM users WHERE referral_code = ?5),
             COALESCE((SELECT 'invite' FROM users WHERE referral_code = ?5), ?6))
     ON CONFLICT (google_sub) DO UPDATE SET email = excluded.email
     RETURNING id`
  )
    .bind(
      crypto.randomUUID(),
      claims.sub,
      email,
      newReferralCode(),
      REFERRAL_CODE.test(ref) ? ref : null,
      source && /^[a-z0-9.-]{1,40}$/.test(source) ? source : "direct"
    )
    .first<{ id: string }>();

  const sessionVersion = (await getSessionVersion(c.env.DB, user!.id)) ?? 0;
  const headers = new Headers({ Location: safeNext(decodeURIComponent(encodedNext ?? "")) });
  headers.append("Set-Cookie", await createSessionCookie(c.env.SESSION_SECRET, user!.id, sessionVersion));
  headers.append("Set-Cookie", `${LOGIN_COOKIE}=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0`);
  if (ref) headers.append("Set-Cookie", `${REF_COOKIE}=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0`);
  if (source) headers.append("Set-Cookie", `${SOURCE_COOKIE}=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0`);
  return new Response(null, { status: 302, headers });
});

app.route("/", reviewLogin); // TEMPORARY: reviewer sign-in, see src/review-login.ts

app.post("/logout", async (c) => {
  // Bump the user's session_version so this cookie (and any other copy of it) stops
  // verifying, instead of just clearing it client-side.
  const session = await readSession(c.env.SESSION_SECRET, c.req.raw);
  if (session) await bumpSessionVersion(c.env.DB, session.userId);
  c.header("Set-Cookie", clearSessionCookie);
  // "Not you?" on the consent page: sign in again and come back to the same connection.
  const next = String((await c.req.parseBody()).next ?? "");
  return c.redirect(next ? `/login?next=${encodeURIComponent(safeNext(next))}` : "/");
});

// --- MCP OAuth: the page Claude/ChatGPT send the user to when connecting ------------

async function userEmail(db: D1Database, userId: string): Promise<string> {
  const row = await db.prepare(`SELECT email FROM users WHERE id = ?`).bind(userId).first<{ email: string }>();
  return row?.email ?? "you";
}

async function oauthErrorResponse(c: Ctx, error: unknown): Promise<Response> {
  if (error instanceof AuthorizationError && error.redirectUri) {
    const redirect = new URL(error.redirectUri);
    redirect.searchParams.set("error", error.code);
    redirect.searchParams.set("error_description", error.description);
    if (error.state) redirect.searchParams.set("state", error.state);
    if (error.issuer) redirect.searchParams.set("iss", error.issuer);
    return c.redirect(redirect.href);
  }
  if (error instanceof AuthorizationError) return c.html(errorPage(error.description), 400);
  if (error instanceof CimdFetchError) return c.html(errorPage("This app could not be verified."), 400);
  throw error;
}

app.get("/authorize", async (c) => {
  const oauth = c.env.OAUTH_PROVIDER;
  try {
    const request = await oauth.parseAuthRequest(c.req.raw);
    const userId = await sessionUser(c);
    if (!userId) {
      const here = new URL(c.req.url);
      return c.redirect(`/login?next=${encodeURIComponent(here.pathname + here.search)}`);
    }
    const client = await oauth.lookupClient(request.clientId);
    if (!client) return c.html(errorPage("Unknown app."), 400);

    // Skip the consent screen for an app this user already approved in this browser.
    const remember = { secret: c.env.SESSION_SECRET, subject: userId };
    if (await oauth.isConsentRemembered(c.req.raw, request, remember)) {
      const { redirectTo } = await oauth.completeAuthorization({
        request,
        userId,
        metadata: { clientName: client.clientName },
        scope: request.scope,
        props: { userId, clientName: sourceLabel(client.clientName) } satisfies AuthProps
      });
      await recordConnect(c.env.DB, userId, sourceLabel(client.clientName));
      return c.redirect(redirectTo);
    }

    const consent = await oauth.beginConsent(request);
    consent.headers.set("Content-Type", "text/html; charset=utf-8");
    const here = new URL(c.req.url);
    const body = await consentPage(client, request, consent.handle, await userEmail(c.env.DB, userId), here.pathname + here.search);
    return new Response(body.toString(), { headers: consent.headers });
  } catch (error) {
    return oauthErrorResponse(c, error);
  }
});

app.post("/authorize", async (c) => {
  const oauth = c.env.OAUTH_PROVIDER;
  const userId = await sessionUser(c);
  if (!userId) return c.html(errorPage("Your session expired. Start connecting again from your AI app."), 401);
  try {
    const form = await c.req.formData();
    const handle = String(form.get("handle"));
    if (form.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(c.req.raw, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const approved = await oauth.approveConsent(c.req.raw, handle, {
      remember: { secret: c.env.SESSION_SECRET, subject: userId }
    });
    const client = await oauth.lookupClient(approved.request.clientId);
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId,
      metadata: { clientName: client?.clientName },
      scope: approved.request.scope,
      props: { userId, clientName: sourceLabel(client?.clientName) } satisfies AuthProps
    });
    // Connecting a first AI app is what earns an invited user (and their inviter) free Pro.
    await rewardReferral(c.env.DB, userId);
    await recordConnect(c.env.DB, userId, sourceLabel(client?.clientName));
    approved.headers.set("Location", redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (error) {
    return oauthErrorResponse(c, error);
  }
});

// --- The memory UI (signed-in only) ------------------------------------------------

const INVITE_SEEN_COOKIE = "__Host-context-invite-seen";

app.get("/", async (c) => {
  const userId = await sessionUser(c);
  if (!userId) return c.html(landingPage(site(c), undefined, !!readCookie(c, REF_COOKIE)));
  const [memories, code, connectedAt, cleanupCount] = await Promise.all([
    listActive(c.env.DB, userId),
    referralCode(c.env.DB, userId),
    firstConnectedAt(c.env.DB, userId),
    countPending(c.env.DB, userId)
  ]);
  const query = (c.req.query("q") ?? "").trim().slice(0, 200);
  // Right after their first AI app connects, the invite link shows once at the top (the cookie
  // remembers it was seen); otherwise it's a small card at the bottom.
  const justConnected =
    !!connectedAt && connectedAt > new Date(Date.now() - 7 * 86400_000).toISOString() && !readCookie(c, INVITE_SEEN_COOKIE);
  if (justConnected) c.header("Set-Cookie", `${INVITE_SEEN_COOKIE}=1; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${365 * 86400}`);
  const invite = { link: `${c.env.PUBLIC_URL}/r/${code}`, justConnected };
  return c.html(memoriesPage(filterMemories(memories, query), { query, total: memories.length, invite, cleanupCount }));
});

// Private funnel numbers. Anyone not in ADMIN_EMAILS gets the normal 404.
app.get("/stats", async (c) => {
  const userId = await sessionUser(c);
  const admins = (c.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!userId || !admins.includes(await userEmail(c.env.DB, userId))) return c.html(notFoundPage(!!userId), 404);
  c.header("Cache-Control", "no-store");
  return c.html(statsPage(await funnelStats(c.env.DB)));
});

const requireUser = async (c: Ctx, next: () => Promise<void>) => {
  const userId = await sessionUser(c);
  if (!userId) return c.redirect(`/login?next=${encodeURIComponent(new URL(c.req.url).pathname)}`);
  c.set("userId", userId);
  await next();
};
app.use("/import", requireUser);
app.use("/connect", requireUser);
app.use("/memories/*", requireUser);
app.use("/export/*", requireUser);
app.use("/account", requireUser);
app.use("/account/*", requireUser);
app.use("/billing/*", requireUser);
app.use("/history", requireUser);
app.use("/history/*", requireUser);
app.use("/invite", requireUser);
app.use("/backup/*", requireUser);
app.use("/cleanup", requireUser);
app.use("/cleanup/*", requireUser);

interface AccountRow {
  id: string;
  email: string;
  /** The plan they get, counting free Pro from referrals. */
  plan: "free" | "pro";
  /** What they pay for. */
  paid_plan: "free" | "pro";
  pro_until: string | null;
  bonus_days: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  history_until: string | null;
  active: number;
  history: number;
}

async function account(db: D1Database, userId: string): Promise<AccountRow> {
  return (await db
    .prepare(
      `SELECT u.id, u.email, ${PLAN_SQL} AS plan, u.plan AS paid_plan, u.pro_until, u.bonus_days, u.stripe_customer_id, u.stripe_subscription_id, u.history_until,
              COALESCE(SUM(m.status = 'active'), 0) AS active, COALESCE(SUM(m.status != 'active'), 0) AS history
       FROM users u LEFT JOIN memories m ON m.user_id = u.id WHERE u.id = ? GROUP BY u.id`
    )
    .bind(userId)
    .first<AccountRow>())!;
}

async function renderAccount(c: Ctx, error?: string, extra: { newKey?: string; notice?: string } = {}) {
  const userId = c.get("userId");
  const [a, keys, backup, cleanup, pending] = await Promise.all([
    account(c.env.DB, userId),
    listApiKeys(c.env.DB, userId),
    getBackup(c.env.DB, userId),
    cleanupSettings(c.env.DB, userId),
    countPending(c.env.DB, userId)
  ]);
  return accountPage(
    {
      email: a.email,
      plan: a.plan,
      paid: a.paid_plan === "pro",
      proUntil: a.pro_until,
      bonusDays: a.bonus_days,
      active: a.active,
      history: a.history,
      historyUntil: a.history_until,
      billing: billingEnabled(c.env),
      canManage: !!a.stripe_customer_id,
      upgraded: c.req.query("upgraded") === "1",
      keys,
      newKey: extra.newKey,
      mcpUrl: `${c.env.PUBLIC_URL}/mcp`,
      backup,
      backupsAvailable: backupsAvailable(c.env),
      cleanup: { available: cleanupAvailable(c.env), ...cleanup, pending },
      notice: extra.notice ?? NOTICES[c.req.query("done") ?? ""]
    },
    error
  );
}

// Short results of actions that redirect back to /account (?done=...).
const NOTICES: Record<string, string> = {
  "backup-connected": "Google Drive is connected. Your first backup is in the “Context Backups” folder.",
  "backup-saved": "Backup saved to Google Drive.",
  "backup-disconnected": "Google Drive is disconnected. Your existing backups are still in your Drive.",
  "backup-frequency": "Backup schedule saved.",
  "cleanup-saved": "Cleanup setting saved.",
  "key-deleted": "API key deleted. Anything using it has lost access."
};

app.get("/account", async (c) => c.html(await renderAccount(c)));

// --- Pro tools: API keys --------------------------------------------------------

app.post("/account/keys", async (c) => {
  const name = String((await c.req.formData()).get("name") ?? "");
  const result = await createApiKey(c.env.DB, c.get("userId"), name);
  if (result === "not-pro") return c.redirect("/account", 303);
  if (result === "limit") return c.html(await renderAccount(c, undefined, { notice: "You have the most keys allowed (10). Delete one first." }), 400);
  c.header("Cache-Control", "no-store");
  return c.html(await renderAccount(c, undefined, { newKey: result.key }));
});

app.post("/account/keys/:id/revoke", async (c) => {
  await revokeApiKey(c.env.DB, c.get("userId"), c.req.param("id"));
  return c.redirect("/account?done=key-deleted#api-keys", 303);
});

// --- Pro tools: Google Drive backups -----------------------------------------------

const DRIVE_COOKIE = "__Host-context-drive";

app.get("/backup/google/connect", async (c) => {
  const a = await account(c.env.DB, c.get("userId"));
  if (a.plan !== "pro" || !backupsAvailable(c.env)) return c.redirect("/account", 303);
  const state = crypto.randomUUID();
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", c.env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", backupRedirectUri(c.env));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", `openid email ${DRIVE_SCOPE}`);
  // offline + consent: Google only returns a refresh token (needed for the nightly backup) this way.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("login_hint", a.email);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  c.header("Set-Cookie", `${DRIVE_COOKIE}=${state}|${verifier}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=600`);
  return c.redirect(url.toString());
});

app.get("/backup/google/callback", async (c) => {
  const userId = c.get("userId");
  const [expectedState, verifier] = readCookie(c, DRIVE_COOKIE)?.split("|") ?? [];
  c.header("Set-Cookie", `${DRIVE_COOKIE}=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0`);
  if (c.req.query("error")) return c.redirect("/account", 303); // the user said no on Google's page
  const code = c.req.query("code");
  if (!code || !expectedState || !verifier || c.req.query("state") !== expectedState) {
    return c.html(errorPage("Connecting Google Drive expired or was started in another browser. Please try again."), 400);
  }
  if (!backupsAvailable(c.env) || (await account(c.env.DB, userId)).plan !== "pro") return c.redirect("/account", 303);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: backupRedirectUri(c.env)
    })
  });
  const token = await res.json<{ refresh_token?: string; scope?: string; id_token?: string }>();
  // Google's consent page lets people untick the Drive permission; without it there's nothing to do.
  if (!token.refresh_token || !(token.scope ?? "").split(" ").includes(DRIVE_SCOPE)) {
    return c.html(errorPage("Context needs permission to add files to your Google Drive. Please try again and leave that box ticked."), 400);
  }
  let email: string | null = null;
  if (token.id_token) {
    try {
      email = (JSON.parse(atob(token.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as GoogleIdToken).email ?? null;
    } catch {
      email = null;
    }
  }
  await saveConnection(c.env, userId, token.refresh_token, email);
  const error = await backupUser(c.env, userId);
  return c.redirect(error ? "/account" : "/account?done=backup-connected", 303);
});

app.post("/backup/now", async (c) => {
  const wait = await manualBackupWait(c.env.DB, c.get("userId"));
  if (wait > 0) {
    return c.html(await renderAccount(c, undefined, { notice: `A backup just ran. You can back up again in ${wait} minute${wait === 1 ? "" : "s"}.` }), 429);
  }
  const error = await backupUser(c.env, c.get("userId"));
  return error ? c.html(await renderAccount(c, undefined, { notice: error }), 400) : c.redirect("/account?done=backup-saved", 303);
});

app.post("/backup/frequency", async (c) => {
  const f = (await c.req.formData()).get("frequency") === "weekly" ? "weekly" : "daily";
  await setFrequency(c.env.DB, c.get("userId"), f);
  return c.redirect("/account?done=backup-frequency", 303);
});

app.post("/backup/disconnect", async (c) => {
  await disconnectBackup(c.env, c.get("userId"));
  return c.redirect("/account?done=backup-disconnected", 303);
});

// --- Pro tools: automatic cleanup ---------------------------------------------------

async function renderCleanup(c: Ctx, notice?: string) {
  const userId = c.get("userId");
  const [a, settings] = await Promise.all([account(c.env.DB, userId), cleanupSettings(c.env.DB, userId)]);
  const pro = a.plan === "pro";
  const items = pro ? await pendingSuggestions(c.env.DB, userId) : [];
  const cooldown = new Date(Date.now() - MANUAL_COOLDOWN_MINUTES * 60_000).toISOString();
  return cleanupPage(items, {
    pro,
    available: cleanupAvailable(c.env),
    billing: billingEnabled(c.env),
    lastRun: settings.lastRun,
    canRunNow: !settings.lastRun || settings.lastRun < cooldown,
    notice
  });
}

// The actions need Pro; the page itself explains Pro to everyone else. ("/cleanup/*" also
// matches "/cleanup", which must stay reachable or this would redirect to itself.)
app.use("/cleanup/*", async (c, next) => {
  if (c.req.path !== "/cleanup" && (await account(c.env.DB, c.get("userId"))).plan !== "pro") return c.redirect("/cleanup", 303);
  await next();
});

app.get("/cleanup", async (c) => c.html(await renderCleanup(c)));

app.post("/cleanup/run", async (c) => {
  const userId = c.get("userId");
  const { lastRun } = await cleanupSettings(c.env.DB, userId);
  const cooldown = new Date(Date.now() - MANUAL_COOLDOWN_MINUTES * 60_000).toISOString();
  if (!cleanupAvailable(c.env) || (lastRun && lastRun >= cooldown)) return c.redirect("/cleanup", 303);
  const found = await cleanupUser(c.env, userId);
  return c.html(await renderCleanup(c, found ? `Found ${found} thing${found === 1 ? "" : "s"} to tidy up.` : "Everything looks tidy."));
});

app.post("/cleanup/apply-all", async (c) => {
  const userId = c.get("userId");
  let n = 0;
  for (const s of await pendingSuggestions(c.env.DB, userId)) {
    if (s.kind === "merge" && (await applySuggestion(c.env.DB, userId, s.id))) n++;
  }
  return c.html(await renderCleanup(c, `Combined ${n} repeat${n === 1 ? "" : "s"}. Undo any of them from History.`));
});

app.post("/cleanup/auto", async (c) => {
  await setCleanupAuto(c.env.DB, c.get("userId"), (await c.req.formData()).get("auto") === "1");
  return c.redirect("/account?done=cleanup-saved", 303);
});

app.post("/cleanup/:id/apply", async (c) => {
  const ok = await applySuggestion(c.env.DB, c.get("userId"), c.req.param("id"));
  return c.html(await renderCleanup(c, ok ? "Done. You can undo it from History." : "That suggestion no longer fits your memories, so it was skipped."));
});

app.post("/cleanup/:id/dismiss", async (c) => {
  await dismissSuggestion(c.env.DB, c.get("userId"), c.req.param("id"));
  return c.redirect("/cleanup", 303);
});

// Sends the user to Stripe's hosted checkout. Someone already on Pro goes to the portal
// instead, so nobody ends up paying for two subscriptions.
app.post("/billing/checkout", async (c) => {
  if (!billingEnabled(c.env)) return c.redirect("/account", 303);
  const a = await account(c.env.DB, c.get("userId"));
  if (a.paid_plan === "pro" && a.stripe_customer_id) return c.redirect(await createPortal(c.env, a.stripe_customer_id), 303);
  const interval = (await c.req.formData()).get("interval") === "year" ? "year" : "month";
  return c.redirect(await createCheckout(c.env, a, interval), 303);
});

app.post("/billing/portal", async (c) => {
  const a = await account(c.env.DB, c.get("userId"));
  if (!billingEnabled(c.env) || !a.stripe_customer_id) return c.redirect("/account", 303);
  return c.redirect(await createPortal(c.env, a.stripe_customer_id), 303);
});

app.get("/history", async (c) => {
  const a = await account(c.env.DB, c.get("userId"));
  // A lapsed Pro account can still look at (but not restore) history during its grace period.
  const entries = a.plan === "pro" || a.history > 0 ? await listHistory(c.env.DB, a.id) : [];
  return c.html(historyPage(entries, { plan: a.plan, billing: billingEnabled(c.env), historyUntil: a.history_until }));
});

app.post("/history/:id/restore", async (c) => {
  const userId = c.get("userId");
  const a = await account(c.env.DB, userId);
  if (a.plan !== "pro") return c.redirect("/history", 303);
  const result = await restoreMemory(c.env.DB, userId, c.req.param("id"));
  if (result === "limit") return c.html(errorPage(limitMessage("pro")), 400);
  return c.redirect(result ? "/" : "/history", 303);
});

// Revokes every assistant's access first: if deleting the data then failed, the user could
// retry, but a grant left behind for a deleted user would be an orphaned credential.
app.post("/account/delete", async (c) => {
  const userId = c.get("userId");
  const form = await c.req.formData();
  if (String(form.get("confirm") ?? "").trim().toLowerCase() !== "delete") {
    return c.html(await renderAccount(c, "Type delete to confirm."), 400);
  }
  // Stop billing first: a paid subscription left running for a deleted account would keep charging.
  const a = await account(c.env.DB, userId);
  if (a.stripe_subscription_id && billingEnabled(c.env)) await cancelSubscription(c.env, a.stripe_subscription_id);
  const oauth = c.env.OAUTH_PROVIDER;
  let cursor: string | undefined;
  do {
    const page = await oauth.listUserGrants(userId, { cursor });
    for (const grant of page.items) await oauth.revokeGrant(grant.id, userId);
    cursor = page.cursor;
  } while (cursor);
  await disconnectBackup(c.env, userId);
  await deleteUserData(c.env.DB, userId);
  c.header("Set-Cookie", clearSessionCookie);
  return c.html(accountDeletedPage());
});

// Downloads of everything active, so the user can take their memory elsewhere.
app.get("/export/memories.json", async (c) => {
  const json = exportJson(await listActive(c.env.DB, c.get("userId")), new Date().toISOString());
  return c.body(json, 200, download("application/json", "json"));
});

app.get("/export/memories.md", async (c) => {
  const md = exportMarkdown(await listActive(c.env.DB, c.get("userId")), new Date().toISOString());
  return c.body(md, 200, download("text/markdown", "md"));
});

function download(type: string, ext: string): Record<string, string> {
  const date = new Date().toISOString().slice(0, 10);
  return {
    "Content-Type": `${type}; charset=utf-8`,
    "Content-Disposition": `attachment; filename="context-memories-${date}.${ext}"`,
    "Cache-Control": "no-store"
  };
}

const IMPORT_BATCH = 2500;

app.get("/invite", async (c) => {
  const userId = c.get("userId");
  let stats = await referralStats(c.env.DB, userId);
  // Accounts created before referrals, or while the migration was rolling out, get a code here.
  if (!stats.code) {
    await c.env.DB.prepare(`UPDATE users SET referral_code = ? WHERE id = ? AND referral_code IS NULL`)
      .bind(newReferralCode(), userId)
      .run();
    stats = await referralStats(c.env.DB, userId);
  }
  return c.html(invitePage(`${c.env.PUBLIC_URL}/r/${stats.code}`, stats));
});

app.get("/import", (c) => c.html(importPage(IMPORT_PROMPT)));

app.post("/import", async (c) => {
  const form = await c.req.formData();
  const source = String(form.get("source") ?? "import").slice(0, 40);
  const { memories, skipped } = parseImport(String(form.get("text") ?? ""));
  // At most 2,500 rows per paste bounds one request's work (saved in batches of 500); larger imports go in parts.
  const { left: allowance, plan } = await writeAllowance(c.env.DB, c.get("userId"));
  const take = Math.min(IMPORT_BATCH, allowance);
  const saved = await insertMemories(c.env.DB, c.get("userId"), memories.slice(0, take), source);
  const overLimit =
    memories.length <= take
      ? undefined
      : allowance <= IMPORT_BATCH
        ? limitMessage(plan)
        : `Up to ${IMPORT_BATCH} memories are imported per paste. Paste the remaining lines again to import them.`;
  return c.html(importResultPage(saved.length, skipped, overLimit));
});

app.get("/connect", (c) => c.html(connectPage(`${c.env.PUBLIC_URL}/mcp`)));

// The memories page sends these in the background (X-Fragment: 1) and swaps the card in
// place, so the page keeps its scroll position. Plain form posts still get a redirect.
const isFragment = (c: Ctx) => c.req.header("X-Fragment") === "1";

function cardOrRedirect(c: Ctx, memory: Memory | null) {
  if (!isFragment(c)) return c.redirect("/");
  return memory ? c.html(memoryCard(memory)) : c.body(null, 404);
}

// Edits made by the user are, by definition, things the user said.
app.post("/memories/:id/edit", async (c) => {
  const form = await c.req.formData();
  const content = String(form.get("content") ?? "").trim();
  const category = String(form.get("category")) as Category;
  if (!content || !CATEGORIES.includes(category)) return isFragment(c) ? c.body(null, 400) : c.redirect("/");
  const updated = await updateMemory(c.env.DB, c.get("userId"), c.req.param("id"), { content, category, explicit: true }, "You");
  return cardOrRedirect(c, updated);
});

app.post("/memories/:id/confirm", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const confirmed = await confirmMemory(c.env.DB, userId, id);
  return cardOrRedirect(c, confirmed ? await getActive(c.env.DB, userId, id) : null);
});

app.post("/memories/:id/forget", async (c) => {
  const forgotten = await forgetMemory(c.env.DB, c.get("userId"), c.req.param("id"));
  if (!isFragment(c)) return c.redirect("/");
  return forgotten ? c.body(null, 204) : c.body(null, 404);
});

app.notFound(async (c) => c.html(notFoundPage(!!(await sessionUser(c))), 404));

export default app;
