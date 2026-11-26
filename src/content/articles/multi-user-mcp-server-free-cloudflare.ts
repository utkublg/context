import type { Article } from "../types";

const article: Article = {
  slug: "multi-user-mcp-server-free-cloudflare",
  kind: "post",
  title: "Running a multi-user MCP server for $0 on Cloudflare",
  description:
    "One Worker, D1, KV and no Durable Objects: how Context serves OAuth and MCP for many users on Cloudflare's free plan, and where that breaks.",
  published: "2026-11-11",
  body: `
<p>Context is a remote MCP server. ChatGPT, Claude and other assistants connect to it over OAuth and use it as a shared memory for one person. Each user has their own memories and their own grants, and the assistants connect from the vendors' clouds rather than from a laptop. I'm one developer, and I wanted the running cost to be zero until people actually use it. This is how it's built, with the free-plan limits it has to fit inside and the places I expect it to break.</p>

<h2>The whole thing is one Worker</h2>

<pre><code>ChatGPT / Claude / Gemini / Grok           you, in a browser
        |  MCP over HTTPS + Bearer token          |
        v                                          v
+---------------------------- one Worker -----------------------------+
|  static assets (public/: CSS, fonts)  served before the Worker runs |
|                                                                      |
|  OAuthProvider (@cloudflare/workers-oauth-provider)                  |
|    /.well-known/*, /oauth/register, /oauth/token   --&gt; KV (grants,  |
|                                                         tokens)     |
|    /mcp  (valid token only)  --&gt; createMcpHandler --&gt; src/mcp.ts    |
|    everything else           --&gt; Hono app (src/web.ts):            |
|        /login, /auth/google/callback, /authorize (consent),         |
|        /, /import, /connect, /history, /export ...                  |
|                                                    all --&gt; D1       |
|  scheduled(): daily 03:17 UTC  --&gt; purge expired history in D1      |
+----------------------------------------------------------------------+</code></pre>

<p>There's one deployable, two storage bindings (D1 for data, and KV only because the OAuth library wants it), one cron trigger and a folder of static files. No Durable Objects, no queues, no vector index, and no LLM calls from the server.</p>

<h2>OAuth: the part you can't skip</h2>

<p>Claude and ChatGPT connect to remote MCP servers with OAuth. I didn't want to write an authorization server, so <code>@cloudflare/workers-oauth-provider</code> wraps the whole Worker. It serves discovery metadata, client registration and the token endpoint, and it checks the bearer token before a request ever reaches <code>/mcp</code>:</p>

<pre><code>provider ??= new OAuthProvider&lt;Env&gt;({
  apiRoute: "/mcp",
  apiHandler: mcpApi,
  defaultHandler: web,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  // Dynamic client registration: how Claude and ChatGPT sign themselves up today.
  clientRegistrationEndpoint: "/oauth/register",
  // Client ID Metadata Documents: the newer MCP registration style.
  clientIdMetadataDocumentEnabled: true,
  scopesSupported: ["memory"],
  resourceMetadata: { resource: \`\${base}/mcp\`, authorization_servers: [base], ... }
});</code></pre>

<p>Clients can arrive two ways. With dynamic client registration they POST their own metadata to <code>/oauth/register</code>. With Client ID Metadata Documents (CIMD) the client id is an HTTPS URL that the library fetches. That fetch is why <code>wrangler.jsonc</code> enables the <code>global_fetch_strictly_public</code> compatibility flag: the library needs it as SSRF protection. The consent page uses the difference between the two. A CIMD client gets "Published by <em>host</em>", and a self-registered one gets "This app registered itself; its name is not verified." It also shows the host the authorization will be sent to.</p>

<p>The <code>/authorize</code> page is mine. If you aren't signed in, it redirects to Google. Then it either skips consent (if you already approved this app in this browser) or renders the "Let Claude use your Context?" page. On approval, the grant gets two props, <code>userId</code> and a normalized client name. The library stores those encrypted with the grant and hands them back on every MCP request as <code>ctx.props</code>. That's the entire multi-tenancy mechanism: every query in <code>src/memories.ts</code> is scoped by that <code>userId</code>.</p>

<p>Google is used only for identity, with the <code>openid email</code> scopes and PKCE. The ID token comes straight from Google's token endpoint over TLS, authenticated with the client secret. OpenID Connect allows trusting a token received that way without re-verifying its signature, so the callback only checks <code>iss</code>, <code>aud</code>, <code>exp</code> and <code>email_verified</code>. Users are keyed on Google's <code>sub</code>, not the email, because emails can change.</p>

<h2>A stateless MCP handler</h2>

<p>The common way to host MCP on Cloudflare uses a Durable Object per session. I don't need sessions. Every tool call is a self-contained read or write against D1, so each request builds a fresh server:</p>

<pre><code>// A fresh MCP server per request keeps the Worker stateless: no Durable Objects to pay for.
const mcpApi = {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const props = (ctx as ExecutionContext &amp; { props: AuthProps }).props;
    return createMcpHandler(() =&gt; buildMcpServer(env, props), {
      route: "/mcp",
      allowedHostnames: [new URL(env.PUBLIC_URL).hostname]
    })(request, env, ctx);
  }
};</code></pre>

<p><code>buildMcpServer</code> registers six tools and closes over <code>env.DB</code> and the user's id. Building it is cheap: no I/O, just a few objects. The trade-off is that the server can't push anything to the client between requests, and nothing survives from one request to the next. For a memory store that's fine. For something that streams long-running progress, it wouldn't be.</p>

<p>Being stateless also made testing easy. The same <code>buildMcpServer</code> runs in-process in my test bench against a <code>node:sqlite</code> database shaped like D1.</p>

<h2>D1 as the only real database</h2>

<p>The schema is two tables, <code>users</code> and <code>memories</code>, plus seven small migrations. A memory is a single sentence with a category, a source ("ChatGPT", "Claude"), whether the user said it or an AI inferred it, and a status of <code>active</code>, <code>superseded</code> or <code>forgotten</code>. Edits on Pro insert a new row and mark the old one superseded, in one <code>db.batch()</code>. Free accounts overwrite in place.</p>

<p>One D1 quirk I hit: SQLite can't alter a <code>CHECK</code> constraint, so adding a category meant rebuilding the table. D1 enforces foreign keys and ignores <code>PRAGMA foreign_keys=OFF</code>. The migration uses <code>PRAGMA defer_foreign_keys = true</code> and renames the old table out of the way first. Building a new table and dropping the original would make every self-reference look orphaned at commit.</p>

<h2>Keyword search in the Worker, not a vector DB</h2>

<p>This is the choice that looks most like a shortcut. <code>search_context</code> loads the user's active memories and scores them in JavaScript:</p>

<pre><code>export function searchMemories(memories: Memory[], query: string, limit: number): Memory[] {
  const q = new Set(terms(query));
  if (q.size === 0) return [];
  return memories
    .map((m) =&gt; {
      const words = new Set(terms(\`\${m.content} \${CATEGORY_LABELS[m.category]}\`));
      let hits = 0;
      for (const t of q) if (words.has(t)) hits++;
      // Coverage of the query dominates; explicit facts win ties over inferences.
      const score = hits / q.size + (hits &gt; 0 ? m.explicit * 0.05 : 0);
      return { m, score };
    })
    ...</code></pre>

<p><code>terms()</code> lowercases, drops stopwords and does crude suffix stripping, so "decided" and "decision" meet. That's the whole search.</p>

<p>It's fine because of the shape of the data. One person has a few hundred short sentences, not a corpus. The caller is an LLM that writes a focused query and can call again with different words. <code>get_context</code> hands it a categorized overview of up to 150 memories, which covers most of what a typical account holds. And when there's no match, the tool says so and suggests a broader query or <code>get_context</code>. A vector index would add a second store to keep in sync and an embedding call on every write, and it would be one more thing to pay for. The code comment states the rule I'm following: swap in embeddings only if real usage shows keyword search missing relevant memories.</p>

<h2>Import without an LLM</h2>

<p>Moving your memory from ChatGPT to Context could have been "paste your chat export and we'll summarize it", which means an LLM bill on my side. Instead the import page gives you a prompt to paste into the assistant that knows you best. That assistant does the extraction on your subscription and answers in a strict line format:</p>

<pre><code>[preferences] [said] [unknown] Prefers concise answers without long introductions.
[decisions] [said] [2023-11-20] Decided to stop pursuing cybersecurity to focus on entrepreneurship.</code></pre>

<p>A regex parses it. Lines inside a code fence count, chatter outside the fence is dropped, and impossible or future dates become "unknown". One paste saves at most 2,500 rows, in batches of 500. The Markdown export uses the same line format, so an export can be imported again.</p>

<h2>A session cookie without a session table</h2>

<p>The web UI's login is a signed cookie: <code>userId.sessionVersion.expiresAt.hmac</code>, HMAC-SHA256 with a secret, in a <code>__Host-</code> cookie that's <code>HttpOnly</code>, <code>Secure</code> and <code>SameSite=Lax</code>, for 30 days. There are no session rows to create or clean up. For revocation, each user has a <code>session_version</code> column. Logout increments it, and every cookie carrying the old number stops working. So it isn't zero database access (each signed-in page reads one integer), but there's nothing to garbage-collect. POSTs also check the <code>Origin</code> header as a second layer against cross-site forms.</p>

<h2>Write limits instead of rate limits</h2>

<p>An assistant stuck in a loop is a more realistic threat than an attacker. So every write path (<code>remember</code>, <code>update_memory</code>, <code>merge_memories</code>, import, restore) asks <code>writeAllowance</code> first:</p>

<pre><code>export const MAX_ACTIVE = 10_000;
export const MAX_TOTAL_ROWS = 30_000;
// ...one query: the user's plan, active count and total rows (history included)
const byTotal = MAX_TOTAL_ROWS - (row?.total ?? 0);
const byActive = opts.addsActive ? MAX_ACTIVE - (row?.active ?? 0) : Infinity;</code></pre>

<p>Updates and merges don't add active memories, so only the total cap applies to them. That total cap exists because Pro keeps every old version, and an update loop would otherwise grow an account forever. When a cap is hit, the tool returns an error whose text tells the model what to do: merge or forget memories, or clean up on the website.</p>

<h2>Cron and static assets</h2>

<p>One cron trigger (<code>17 3 * * *</code>) calls <code>purgeExpiredHistory</code>, which deletes old versions for free accounts whose 30-day grace period has ended, in a single batch. Active memories are never touched.</p>

<p>CSS and self-hosted fonts live in <code>public/</code> and are served as Workers static assets, with a <code>_headers</code> file making fonts immutable. Cloudflare's docs say requests to static assets are free and unlimited. Only requests that run the Worker script count.</p>

<h2>The free plan limits this has to live within</h2>

<p>From Cloudflare's docs as of today (<a href="https://developers.cloudflare.com/workers/platform/limits/">Workers limits</a>, <a href="https://developers.cloudflare.com/d1/platform/pricing/">D1 pricing</a>, <a href="https://developers.cloudflare.com/d1/platform/limits/">D1 limits</a>, <a href="https://developers.cloudflare.com/kv/platform/pricing/">KV pricing</a>, <a href="https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/">static assets billing</a>):</p>

<table>
<thead><tr><th>resource</th><th>free plan</th></tr></thead>
<tbody>
<tr><td>Worker requests</td><td>100,000 / day</td></tr>
<tr><td>CPU time per HTTP request</td><td>10 ms</td></tr>
<tr><td>Subrequests per invocation</td><td>50</td></tr>
<tr><td>Cron triggers per account</td><td>5</td></tr>
<tr><td>D1 rows read</td><td>5 million / day</td></tr>
<tr><td>D1 rows written</td><td>100,000 / day</td></tr>
<tr><td>D1 database size / account storage</td><td>500 MB / 5 GB</td></tr>
<tr><td>D1 queries per invocation</td><td>50 (a <code>db.batch()</code> counts as one)</td></tr>
<tr><td>KV reads</td><td>100,000 / day</td></tr>
<tr><td>KV writes, deletes, lists</td><td>1,000 / day each</td></tr>
<tr><td>Static asset requests</td><td>free, unlimited</td></tr>
</tbody>
</table>

<p>When a D1 daily limit is exceeded, queries fail until the reset. They aren't throttled. A KV limit is the same: further operations of that type error until 00:00 UTC.</p>

<h2>What breaks first, honestly</h2>

<p><strong>KV writes, not D1.</strong> This surprised me when I worked it out. The OAuth library keeps grants and tokens in KV, and by default an access token lasts one hour. In the library's code, a refresh writes the grant and a new access token: two KV writes. With 1,000 writes a day, that's about 500 refreshes, before counting new registrations and grants. At one refresh an hour, a couple of dozen people with assistants that refresh around the clock could use it all up. So I set the access-token lifetime to a day: a connected app refreshes about once a day, and the same budget covers a few hundred connected apps. The trade-off is that a leaked access token stays valid for longer, though deleting the account still revokes every grant and its tokens at once. Past that, the paid Workers plan removes the problem.</p>

<p><strong>D1 rows read on search.</strong> Each <code>search_context</code> call reads every active memory the user has, and each write's allowance check counts all of their rows. At a few hundred memories per user, 5 million rows a day is still tens of thousands of searches, but it grows linearly with account size. The fix would be SQLite FTS5 in D1, so the database narrows the candidates instead of the Worker.</p>

<p><strong>CPU at the high end.</strong> Scoring a few hundred sentences is about a millisecond, which is what the code comment estimates. I haven't measured an account at the 10,000-memory cap, and that's where I'd expect the 10 ms CPU limit to bite first.</p>

<p><strong>Requests.</strong> Each MCP message is an HTTP request to the Worker, so 100,000 a day is generous for one person and finite for a product. Static assets don't count, which helps the web UI.</p>

<p><strong>What I'd change with real traffic:</strong> FTS5 before embeddings, the paid plan once KV writes get close to the limit, and per-minute rate limiting on <code>/mcp</code>, which today relies only on the write caps. Durable Objects come in only if I need server-initiated messages. None of these require changing the overall architecture, which was the point of keeping it this simple.</p>

<p>"$0" here means it's designed to fit inside Cloudflare's free plan. The domain costs money, and Stripe takes its cut only when someone pays for Pro. The free plan of Context itself is unlimited for personal use. If you want to see what this architecture looks like from the user's side, it's running at <a href="https://keepyourcontext.com">keepyourcontext.com</a>, and you can connect it to Claude or ChatGPT.</p>
`
};

export default article;
