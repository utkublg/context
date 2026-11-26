# Context

A user-owned memory layer that ChatGPT, Claude and other assistants share over MCP.
One Cloudflare Worker serves the MCP endpoint (`/mcp`), the OAuth flow those assistants use to connect, and a small web UI for reviewing memories.

This is the code that runs [keepyourcontext.com](https://keepyourcontext.com), published so you can check what happens to your memories instead of taking our word for it. [/version](https://keepyourcontext.com/version) shows which commit is deployed.

## What this code does with your data

- **AI apps only see what they save or ask for.** The six tools in [`src/mcp.ts`](src/mcp.ts) take short facts the assistant chose to save (one sentence each) and return the memories you've saved. Your conversations, chat history and the assistant's own memory never reach Context: no tool accepts them.
- **What's stored:** your Google account id and email, and your memories (text, category, which app saved it, whether you said it or the AI inferred it, dates). On Pro, also: hashes of your API keys, embeddings of your memories (in Vectorize), cleanup suggestions, and, if you connect Google Drive, that account's email and an AES-GCM-encrypted refresh token. The tables are in [`migrations/`](migrations). Assistants are told not to save health details, passwords or secrets ([`src/mcp.ts`](src/mcp.ts)).
- **Where:** a Cloudflare D1 database in Western Europe, encrypted at rest by Cloudflare. There's no extra encryption in the app, so whoever runs the service can technically read the database. We don't look at anyone's memories except to fix a problem you've reported. OAuth tokens are stored only as hashes, by [`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider).
- **Nothing is sent anywhere else.** The code makes outbound calls only to Google (to sign you in, [`src/web.ts`](src/web.ts), and on Pro to write backups to your own Drive, [`src/backup.ts`](src/backup.ts)) and Stripe (Pro billing, [`src/stripe.ts`](src/stripe.ts)). The only AI calls are Pro features on Cloudflare's own Workers AI: embeddings for search by meaning ([`src/semantic.ts`](src/semantic.ts)) and the weekly cleanup model ([`src/cleanup.ts`](src/cleanup.ts)). There are no third-party analytics, ads or third-party LLM calls (the private `/stats` page counts signups and connected apps, never memory content), and memories are never used for training.
- **Each app needs your consent** on the "Allow … to use your Context?" page before it can connect ([`src/web.ts`](src/web.ts), `/authorize`).
- **You control it:** edit or forget any memory on the website, download everything as JSON or Markdown ([`src/export.ts`](src/export.ts)), or delete your account, which revokes every connected app and the Drive connection and deletes your rows (`deleteUserData` in [`src/memories.ts`](src/memories.ts)); the daily cron then deletes their embeddings from Vectorize (`pruneVectors`). On Free, edits and forgets are permanent; Pro keeps history you can restore, deleted 30 days after Pro ends.

Found a security problem? See [SECURITY.md](SECURITY.md).

## How it fits together

```
ChatGPT / Claude ──(MCP + OAuth token)──► /mcp ──► src/mcp.ts (6 tools) ──► D1 (SQLite)
        │                                                                     ▲
        └─ first connect: /authorize ─► Google sign-in ─► consent page        │
You (browser) ──► / , /import, /connect ──► src/web.ts ─────────────────────────┤
Scripts (Pro API key) ──► /api/v1 ──► src/api.ts ───────────────────────────────┘
```

| File | What it does |
|---|---|
| `src/index.ts` | Entry point. `OAuthProvider` guards `/mcp` and serves the OAuth endpoints; everything else goes to the web app. |
| `src/mcp.ts` | The MCP server (6 tools): `search_context`, `get_context`, `remember`, `update_memory`, `merge_memories`, `forget_memory`, plus the instructions that tell assistants when to use them. Claude gets descriptive wording that fits Anthropic's directory policy; other apps get the wording the bench measured. |
| `src/web.ts` | Google sign-in, the "Allow Claude to use your Context?" consent page, memory list, import, connect instructions, and the public pages (`/what-ai-knows`, guides, blog, `/sitemap.xml`, `/robots.txt`). |
| `src/memories.ts` | All database access and the (deliberately simple) keyword search. |
| `src/semantic.ts` | Pro: search by meaning. Workers AI embeddings (`bge-m3`) in Vectorize, blended with keyword search; falls back to keywords if either is missing or fails. |
| `src/cleanup.ts` | Pro: weekly cleanup. A Workers AI model suggests merges and forgets, which the user applies on `/cleanup` (or merges are applied automatically if they opt in). |
| `src/backup.ts` | Pro: Google Drive backups (`drive.file` scope), daily or weekly, newest 30 kept. |
| `src/apikeys.ts`, `src/api.ts` | Pro: personal API keys, accepted on `/mcp` (via `resolveExternalToken` in `index.ts`) and by the REST API at `/api/v1`. |
| `src/ratelimit.ts` | Per-account request limit (120 a minute) on `/mcp` and `/api/v1`. |
| `src/importer.ts` | The prompt you paste into ChatGPT (plus the public variant on `/what-ai-knows`), and a parser for its answer. No LLM calls on our side. |
| `src/content/` | Guides (`/guides/<slug>`) and blog posts (`/blog/<slug>`). `types.ts` defines an `Article`; each article is a module in `articles/` that must be imported into the list in `index.ts`. Also listed in `/sitemap.xml`. |
| `src/export.ts` | JSON and Markdown downloads of all active memories. The Markdown uses the import line format, so it can be re-imported. |
| `src/referrals.ts` | Invites: `/r/<code>` links, and a month of Pro for both people when the friend approves their first AI app. |
| `src/funnel.ts` | Funnel tracking for the private `/stats` page: where each user came from, which AI apps they connected and used, and the numbers per source. |
| `src/og.ts` | The link-preview card (og:image); `scripts/render-og.sh` renders it to `public/og.png`. |
| `src/review-login.ts` | TEMPORARY: email and password sign-in at `/review-login` for app-directory reviewers (see "Reviewer accounts"). |
| `scripts/grant-pro.mjs` | `npm run grant-pro`: free Pro by hand (see "Giving someone Pro"). |
| `src/crab.ts` | The hermit crab mascot as inline SVG, in six moods. |
| `public/` | `site.css` and self-hosted fonts, served as static assets before the Worker runs. |
| `src/stripe.ts` | Pro billing: Stripe Checkout with Managed Payments, the customer portal, and the webhook that sets each account's plan. |
| `src/session.ts` | Signed login cookie (no session table). |
| `migrations/` | D1 schema. |

Cost-relevant choices: stateless MCP handler (no Durable Objects), keyword search in the Worker for Free (Vectorize only for Pro, embedded lazily on search), import parsed without an LLM, per-account write limits, and hourly crons that each process a few Pro accounts. The free features fit the Cloudflare free plan; the Pro features use Workers AI and Vectorize, which have free allowances but are better on Workers Paid as Pro grows.

## Google sign-in setup (once, ~5 minutes)

Google only confirms who you are; your memories never go to Google.

1. Go to <https://console.cloud.google.com>, create a project (e.g. "Context").
2. Open **Google Auth Platform** → **Get started**. App name "Context", your email as support and contact email, audience **External**.
3. Under **Audience**, leave the app in **Testing** and add your Google address as a **test user**. Testing mode is fine for personal use: no Google review is needed for the `openid email` scopes. (If you turn on Drive backups, publish the app to **In production**: in Testing, Google expires refresh tokens after 7 days and backups stop.)
4. Under **Clients** → **Create client** → type **Web application**. Add this authorized redirect URI:
   - `http://localhost:8787/auth/google/callback`
   - `https://keepyourcontext.com/auth/google/callback` (production)
5. Copy the **Client ID** and **Client secret**.

## Run locally

1. `npm ci`, then copy `.dev.vars.example` to `.dev.vars` and fill in `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `SESSION_SECRET` (`openssl rand -base64 48`). Sign-up is open (`OPEN_SIGNUP` in `wrangler.jsonc`); set it to `"false"` in `.dev.vars` to limit sign-in to `ALLOWED_EMAILS`.
2. `npm run db:migrate:local`
3. `npm run dev`, then open <http://localhost:8787>.

ChatGPT and Claude can't reach `localhost`, so connecting them requires deploying.

## Deploy

Production runs at **https://keepyourcontext.com** (Cloudflare custom domain; `workers.dev` is disabled).
The D1 database and KV namespace already exist and their ids are in `wrangler.jsonc`.

Pushing to `main` deploys: [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) typechecks, applies migrations and deploys, so production always matches a public commit. It needs the repository secrets `CLOUDFLARE_API_TOKEN` (Workers, D1, KV, Workers AI and Vectorize edit) and `CLOUDFLARE_ACCOUNT_ID`.

To deploy by hand instead:

```sh
npm run db:migrate:remote   # only when migrations/ changed
npm run deploy              # scripts/deploy.sh: refuses uncommitted changes, records the commit for /version
```

Secrets live in Cloudflare (`npx wrangler secret list` to see names):
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (see Billing), `TOKEN_ENCRYPTION_KEY` (see Pro features setup), and optionally `ALLOWED_EMAILS` (comma-separated; only used when `OPEN_SIGNUP` isn't `"true"`) and `REVIEW_LOGINS` (see Reviewer accounts).
Change one with `npx wrangler secret put <NAME>`. Rotating `SESSION_SECRET` signs everyone out of the web UI.

Public details live in `wrangler.jsonc` vars: `COMPANY_NAME` and `SUPPORT_EMAIL` appear on the privacy policy, terms, docs and support pages (`/privacy`, `/terms`, `/docs`, `/support`), which directory listings link to.

Plans (`src/memories.ts`): both plans are unlimited for personal use, with a fair-use cap of 10,000 active memories (and 30,000 rows including Pro history, so update loops can't grow an account without bound). Free accounts edit in place (edits overwrite, forgets delete). Pro keeps every old version and forgotten memory, viewable and restorable on `/history`. Pro comes from Stripe (`users.plan`) or free from invites (`users.pro_until`; `PLAN_SQL` combines them). Invite rewards earned while paying are banked in `users.bonus_days` and start when the subscription ends. When Pro ends, history is kept 30 days (`users.history_until`), then a daily cron (`triggers` in `wrangler.jsonc`) deletes it. Listing icons are in `branding/` (`icon-64.png` for ChatGPT, `icon-512.png` elsewhere), rendered from `src/icon.ts` with `rsvg-convert`. The link-preview card `public/og.png` comes from `src/og.ts`: rerun `scripts/render-og.sh` after changing it.

Production Google sign-in uses a "Context web" client whose app is External and In production. Its authorized redirect URIs are `https://keepyourcontext.com/auth/google/callback` and `https://keepyourcontext.com/backup/google/callback`, plus the `localhost:8787` versions for development.

## Pro features setup

Each Pro feature switches itself off when its binding or secret is missing, so a self-hosted copy works without any of this.

**Search by meaning** (Workers AI + Vectorize, bindings `AI` and `VECTORS` in `wrangler.jsonc`). Create the index once, with the metadata index *before* any vectors go in:

```sh
npx wrangler vectorize create context-memories --dimensions=1024 --metric=cosine
npx wrangler vectorize create-metadata-index context-memories --property-name=user_id --type=string
```

Memories are embedded the first time a Pro account searches (up to 300 per search), and the daily cron deletes vectors of memories that changed or were deleted, and of accounts that left Pro. `MIN_SIMILARITY` in `src/semantic.ts` (0.5) is the cut-off for a meaning-only match; tune it against real searches.

**Automatic cleanup** needs only the `AI` binding. The `:37` hourly cron runs a pass for up to 3 Pro accounts whose last pass is a week old; users can also press "Check now" once an hour on `/cleanup`.

**Google Drive backups** (the `:07` hourly cron, up to 5 accounts per run):

1. In the Google Cloud project, enable the **Google Drive API**.
2. Under **Google Auth Platform** → **Data access**, add the scope `https://www.googleapis.com/auth/drive.file` (non-sensitive, so no security assessment).
3. Add the redirect URI `https://keepyourcontext.com/backup/google/callback` (and `http://localhost:8787/backup/google/callback`) to the "Context web" client.
4. `openssl rand -base64 48 | npx wrangler secret put TOKEN_ENCRYPTION_KEY`. It encrypts stored refresh tokens; changing it disconnects everyone's Drive (they reconnect from the Account page).

**API keys** need nothing extra. Keys are `ctx_` + 40 characters, stored as SHA-256 hashes, at most 10 per account, and stop working when Pro ends. Usage is documented on `/docs#api`. `/mcp` and `/api/v1` share a limit of 120 requests a minute per account through the `RATE_LIMIT` binding ([`src/ratelimit.ts`](src/ratelimit.ts)); it needs no setup, and without the binding requests aren't limited.

The GitHub deploy token needs Workers AI and Vectorize permissions too, since the Worker now binds them.

## Billing (Pro)

Pro is sold with Stripe Checkout and **Managed Payments**: Stripe (as Link) is the merchant of record, so it calculates, collects and files VAT/sales tax in 80+ countries, handles fraud, disputes and payment support, and customers manage their subscription at link.com or through our "Manage subscription" button (Stripe's customer portal). It costs 3.5% on top of standard processing fees. Billing stays hidden until it's configured:

1. In the Stripe Dashboard, enable Managed Payments (Settings → Managed Payments). Stripe reviews eligibility.
2. Create a product "Context Pro" with tax code `txcd_10103000` (SaaS, personal use) and two recurring prices: $5/month and $48/year. The prices are tax-inclusive (`tax_behavior=inclusive`), so customers see one final price.
3. Turn on the customer portal (Settings → Billing → Customer portal) with cancel and switching between the two prices allowed.
4. Add a webhook endpoint `https://keepyourcontext.com/stripe/webhook` with events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.
5. Put the price ids in `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY` in `wrangler.jsonc`, and set secrets `npx wrangler secret put STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (the endpoint's signing secret).

The webhook re-fetches the subscription on every event (events can arrive out of order), and the account is found through `subscription.metadata.user_id`, which checkout sets. Deleting an account cancels its subscription. Test end to end in a Stripe sandbox first with card `4242 4242 4242 4242`.

## Giving someone Pro

For early users and friends. They need to have signed in once.

```sh
npm run grant-pro -- someone@example.com              # lifetime (until 2099)
npm run grant-pro -- someone@example.com --months 6   # six months, added to any free Pro they have
npm run grant-pro -- someone@example.com --local      # the local database instead of production
```

It sets `users.pro_until` the way invite rewards do, so invite months still add on top and the 12-invite cap is unaffected. Months given to someone already paying are banked in `bonus_days`, like invite rewards. `/stats` counts these accounts as "granted by hand".

## Stats

`/stats` shows signups, the funnel (signed up → connected an AI app → an AI saved a memory → connected a second app), weekly active users with 2+ apps, Pro counts and a table by source. Only emails in `ADMIN_EMAILS` (`wrangler.jsonc`) can open it; everyone else gets the normal 404.
The source is the first `?utm_source=` (or `?ref=`, `?via=`) tag or referring site a visitor arrives with, kept in a cookie until they sign up, so tag links you post, e.g. `https://keepyourcontext.com/?utm_source=hn`. Invite links count as "invite".

## Reviewer accounts (temporary)

App-directory reviewers need an account they can sign in to without Google 2-step verification, so `/review-login` (linked from nowhere) takes an email and password, but only for the accounts in the `REVIEW_LOGINS` secret. There's no sign-up or password reset. Review accounts get `google_sub` = `review:<email>` and source `review`, so they never clash with a Google account and are easy to spot on `/stats`.

```sh
node scripts/review-account.mjs reviewer@example.com        # prints the password and the secret entry
npx wrangler secret put REVIEW_LOGINS                         # paste entries, comma-separated
```

Reviewers sign in at `/review-login` first, then connect their AI app (the consent page uses the same session). To switch it off, `npx wrangler secret delete REVIEW_LOGINS`: the page becomes a 404. Once reviews are done, delete `src/review-login.ts`, `scripts/review-account.mjs`, the two marked lines in `web.ts` and `REVIEW_LOGINS` in `env.ts`, and delete the review accounts.

## Test bench

`bench/` measures whether Claude uses Context when it should (and leaves it alone when it shouldn't), so changes to tool descriptions or setup advice can be compared instead of guessed.
It runs the real MCP server from `src/mcp.ts` in-process against a throwaway database seeded with a fictional (Pro) user, and talks to Claude through the Anthropic API. Nothing touches production.

- **Scenarios** (`bench/scenarios.ts`): questions that need Context, conflicts with Claude's out-of-date built-in memory, questions that don't need it, facts that should be saved unprompted, changes that should update an existing memory rather than add a duplicate, small talk and one-off tasks that shouldn't be saved, and instructions that should be filed in the right category.
- **Variants** (`bench/variants.ts`): old vs current tool descriptions, "Always available" vs "Auto" tool loading, with or without server instructions and the custom instructions from the connect page.
- **Snapshots** (`bench/snapshots/`): frozen tool definitions to compare against. `v1` is the original release; `v2` is from before `remember`/`update_memory` said not to save an updated fact twice (variants `v2-eager`, `v2-auto+prefs`).

```sh
npm run bench -- --dry                                   # what would run
npm run bench -- --model claude-haiku-5-5 --repeats 1    # cheap smoke run
npm run bench                                            # full matrix
npm run bench -- --variants auto,auto+prefs --scenarios dinner,regex --repeats 5
npm run bench -- --snapshot v2                           # freeze current tool definitions to compare against later
```

Needs `ANTHROPIC_API_KEY` in `.dev.vars` (API usage is billed separately from a Claude subscription). Reports and full transcripts go to `bench/results/` (gitignored).

## MCP Registry

`server.json` is the listing in the [official MCP Registry](https://registry.modelcontextprotocol.io) as `com.keepyourcontext/context`. The registry checks we own the domain by fetching `/.well-known/mcp-registry-auth`, which serves the `MCP_REGISTRY_AUTH` var in `wrangler.jsonc` (a public key; the private key is kept outside the repo). To publish a new version, bump `version` in `server.json`, then `mcp-publisher login http --domain keepyourcontext.com` (with `MCP_PRIVATE_KEY` set) and `mcp-publisher publish`.

## Connect your assistants

Open https://keepyourcontext.com/connect for the address to paste (`https://keepyourcontext.com/mcp`).

- **Claude**: Customize → Connectors → + Add → Add custom connector.
- **ChatGPT**: enable Developer mode (Settings → Apps & Connectors → Advanced), then create a connector with OAuth.

Menu names change often; check each app's current help pages if these don't match.

## License

Context is released under the [O'Saasy License](LICENSE.md): MIT-style, so you can read, change, self-host and share it, except that you can't offer it to others as a competing hosted service. Pull requests are off; bug reports and ideas are welcome as issues.
