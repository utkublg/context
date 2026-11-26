import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { AuthRequest, ClientInfo } from "@cloudflare/workers-oauth-provider";
import { CATEGORIES, CATEGORY_LABELS, MAX_ACTIVE, MAX_TOTAL_ROWS, type HistoryEntry, type Memory, type Plan } from "./memories";
import { PRO_PRICE_LABEL } from "./stripe";
import { MAX_REFERRAL_REWARDS, type ReferralStats } from "./referrals";
import { crab, crabMark, type Mood } from "./crab";
import { articlePath, type Article } from "./content";
import type { SourceStats } from "./funnel";
import type { ApiKey } from "./apikeys";
import type { BackupInfo } from "./backup";
import type { SuggestionView } from "./cleanup";

type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

/** Operator details shown on public pages; set in wrangler.jsonc vars. */
export interface Site {
  company: string;
  email: string;
  mcpUrl: string;
  /** Public repository (SOURCE_URL); the docs link to it when set. */
  source?: string;
}

const Crab = (mood: Mood, label = "") => raw(crab(mood, label));
const MAX = MAX_ACTIVE.toLocaleString("en");

interface PageOpts {
  signedIn?: boolean;
  /** Path of the nav link to mark as the current page. */
  current?: string;
  /** Nav for the landing page, which links to its own sections. */
  landing?: boolean;
  /** Search and sharing details for public pages. */
  meta?: PageMeta;
}

/** Canonical address of public pages, for search engines and link previews. */
export const SITE_URL = "https://keepyourcontext.com";
const DEFAULT_DESCRIPTION = "One memory for all your AI apps. Tell ChatGPT something once, and Claude, Gemini and Grok know it too.";

interface PageMeta {
  description: string;
  /** Path of the page, e.g. "/guides/foo"; becomes the canonical and og:url. */
  path: string;
  type?: "website" | "article";
  /** Structured data, rendered as JSON-LD. */
  jsonLd?: Record<string, unknown>;
}

// The company and source link in the footer. Set from COMPANY_NAME and SOURCE_URL once per
// request (see web.ts), so every page gets them without threading Site through each view.
let footerCompany = "";
let footerSource = "";
export function setFooter(company: string, source = ""): void {
  footerCompany = company;
  footerSource = source;
}

// JSON inside <script> must not be able to close the tag.
const jsonLd = (data: Record<string, unknown>) =>
  raw(`<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`);

// Every page shares this frame. Styles and fonts are static files (public/), cached by the browser.
function shell(title: string, body: Html, opts: PageOpts = {}): Html {
  const link = (href: string, label: string) =>
    html`<a href="${href}" ${opts.current === href ? raw('aria-current="page"') : ""}>${label}</a>`;
  const nav = opts.signedIn
    ? html`${link("/", "Memories")}${link("/import", "Import")}${link("/connect", "Connect")}${link("/history", "History")}${link("/invite", "Invite")}${link("/account", "Account")}
        <form class="inline" method="post" action="/logout"><button>Sign out</button></form>`
    : html`<a class="hide-sm" href="${opts.landing ? "#how" : "/#how"}">How it works</a>
        <a class="hide-sm" href="${opts.landing ? "#pricing" : "/#pricing"}">Pricing</a>
        <a class="hide-sm" href="/guides" ${opts.current === "/guides" ? raw('aria-current="page"') : ""}>Guides</a>
        <a href="/login">Sign in</a>
        <a class="btn btn-primary btn-small" href="/login">Get started</a>`;
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${opts.meta?.description ?? DEFAULT_DESCRIPTION}">
${opts.meta
  ? html`<link rel="canonical" href="${SITE_URL}${opts.meta.path}">
<meta property="og:site_name" content="Context">
<meta property="og:type" content="${opts.meta.type ?? "website"}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${opts.meta.description}">
<meta property="og:url" content="${SITE_URL}${opts.meta.path}">
<meta property="og:image" content="${SITE_URL}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="The Context hermit crab next to the words: Stop telling every AI who you are.">
<meta name="twitter:card" content="summary_large_image">
${opts.meta.jsonLd ? jsonLd(opts.meta.jsonLd) : ""}`
  : ""}
<meta name="theme-color" content="#131210">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/figtree-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/bricolage-grotesque-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/fonts/fonts.css">
<link rel="stylesheet" href="/site.css">
<script>document.documentElement.classList.add("js")</script>
</head>
<body>
<header class="nav${opts.signedIn ? " signed-in" : ""}"><div class="wrap">
  <a class="brand" href="/">${raw(crabMark())}Context</a>
  ${opts.signedIn
    ? html`<button class="menu-btn" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="Menu"><span></span></button>`
    : ""}
  <nav class="nav-links" id="site-nav" aria-label="Main">${nav}</nav>
</div></header>
${body}
<footer class="site"><div class="wrap">
  <span>© ${new Date().getFullYear()} Context${footerCompany ? html` · by ${footerCompany}` : ""}</span>
  <nav aria-label="Footer"><a href="/what-ai-knows">What AI knows</a><a href="/guides">Guides</a><a href="/blog">Blog</a><a href="/docs">Help</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/support">Support</a>${footerSource ? html`<a href="${footerSource}">Source code</a>` : ""}</nav>
</div></footer>
<script>
  // Phone menu: the button shows and hides the links (CSS only hides them when this script runs).
  const menu = document.querySelector(".menu-btn");
  if (menu) {
    const header = menu.closest(".nav");
    const setOpen = (open) => { header.classList.toggle("open", open); menu.setAttribute("aria-expanded", String(open)); };
    menu.addEventListener("click", () => setOpen(!header.classList.contains("open")));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
    document.addEventListener("click", (e) => { if (!header.contains(e.target)) setOpen(false); });
  }
  // Any button with data-copy="<element id>" copies that element's text.
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-copy]");
    if (!btn) return;
    const el = document.getElementById(btn.dataset.copy);
    const label = btn.textContent;
    try { await navigator.clipboard.writeText(el.textContent.trim()); btn.textContent = "Copied"; }
    catch { getSelection().selectAllChildren(el); btn.textContent = "Selected"; }
    setTimeout(() => (btn.textContent = label), 1800);
  });
</script>
</body></html>`;
}

/** An app or text page: the shared frame around a narrow column. */
export function layout(title: string, body: Html, opts: PageOpts = {}): Html {
  return shell(title, html`<main class="app">${body}</main>`, opts);
}

// --- Landing --------------------------------------------------------------------

const ICONS: Record<string, string> = {
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  key: '<circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3M21 12v2"/>',
  box: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>',
  bin: '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  spark: '<path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z"/>',
  swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>'
};
const icon = (name: string) =>
  raw(`<svg viewBox="0 0 24 24" fill="none" stroke="#f5b544" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`);

export function landingPage(site: Site, error?: string, invited = false): Html {
  return shell(
    "Context: one memory for all your AI apps",
    html`<main>
  <div class="wrap">
    <div class="hero">
      <div>
        <h1>Stop repeating yourself to <em>every AI<svg viewBox="0 0 300 20" preserveAspectRatio="none" aria-hidden="true"><path d="M4 14 C 70 4, 150 4, 296 10" fill="none" stroke="#f5b544" stroke-width="5" stroke-linecap="round"/></svg></em>.</h1>
        <p class="lede">Context gives <strong>ChatGPT, Claude, Gemini and Grok</strong> one shared memory. Tell one of them something once, and they all know it.</p>
        ${error ? html`<p class="warn" style="margin-top:20px">${error}</p>` : ""}
        ${invited
          ? html`<p class="invited">${raw("🎁")}<span>A friend invited you! Join and add an AI app, and you <b>both get a month of Pro free</b>.</span></p>`
          : ""}
        <div class="hero-cta">
          <a class="btn btn-primary" href="/login">Get started free</a>
          <a class="btn btn-ghost" href="#how">See how it works</a>
          <small>Free. Sign in with Google, no card.</small>
        </div>
      </div>
      <div class="hero-art">
        ${Crab("waving", "A hermit crab waving hello, its shell glowing")}
      </div>
    </div>
    <ul class="wins" aria-label="What you get">
      <li>${icon("clock")}<div><b>Save time</b><span>No more pasting the same background into every new chat.</span></div></li>
      <li>${icon("spark")}<div><b>Better answers, no effort</b><span>Every AI already knows your work, goals and preferences.</span></div></li>
      <li>${icon("swap")}<div><b>Never locked in</b><span>Switch to the best or cheapest AI any time. Your memory comes too.</span></div></li>
    </ul>
  </div>

  <section class="band" id="how">
    <div class="wrap">
      <div class="section-head">
        <h2>Tell ChatGPT on Tuesday. Claude knows on Friday.</h2>
      </div>
      <div class="relay" id="relay">
        <div class="chat">
          <div class="chat-head"><b>ChatGPT</b><span>Tuesday</span></div>
          <p class="msg you" data-step="1">I stopped eating meat. And I'm training for a big race in April!</p>
          <p class="msg ai" data-step="2">Good luck with the race! I'll remember that.</p>
          <span class="chip" data-step="3">Saved to Context</span>
        </div>
        <div class="ctx" aria-label="Your Context">
          <span class="ctx-title">Your Context</span>
          <div class="mem" data-step="4">
            <div>Doesn't eat meat. Training for a race in April.</div>
            <div class="meta"><span class="tag said">you said</span>from ChatGPT</div>
          </div>
          ${Crab("happy")}
          <div class="arrows"><span>← saved</span><span>used →</span></div>
        </div>
        <div class="chat">
          <div class="chat-head"><b>Claude</b><span>Friday</span></div>
          <p class="msg you" data-step="5">Plan my dinners for next week.</p>
          <span class="chip" data-step="6">Checked Context</span>
          <p class="msg ai" data-step="7">Here are 7 dinners with <mark>no meat</mark>, made for your <mark>race training</mark>: pasta before your long run, tofu stir-fry after it, and lighter meals on rest days.</p>
        </div>
      </div>
      <div class="relay-foot">
        <p class="hand">no more "like I said before…"</p>
        <button class="replay" id="replay" type="button">Play again</button>
      </div>
      <ol class="start" aria-label="How to start">
        <li><b>Sign in with Google</b><span>Free, no card.</span></li>
        <li><b>Add Context to your AI apps</b><span>We show you each step.</span></li>
        <li><b>Chat as usual</b><span>They save what matters and use it.</span></li>
      </ol>
    </div>
  </section>

  <section class="band">
    <div class="wrap">
      <div class="section-head"><h2>You can see and fix everything.</h2></div>
      <div class="duo">
        <div class="card">
          <h3>See what AI guessed about you</h3>
          <p>Each memory shows if you said it or an AI guessed it. Confirm or fix it.</p>
          <div class="memcard focus">
            <div>Maybe a morning person. Often asks for early plans.</div>
            <div class="meta"><span class="tag assumed">AI guessed</span><span>Saved by ChatGPT</span></div>
            <div class="acts"><span>Confirm</span><span>Edit</span><span>Forget</span></div>
          </div>
          <p class="try-link"><a href="/what-ai-knows">Try it now, no sign-up →</a></p>
        </div>
        <div class="card">
          <h3>Bring your old memory in</h3>
          <p>Copy one message into ChatGPT or Claude, paste its answer here. About 30 seconds.</p>
          <div class="memcard">Likes metric units</div>
          <div class="memcard">Sister Defne lives in Izmir</div>
          <div class="progress"><span>Brought in <b>214</b> memories</span><span class="muted">3 repeats joined</span></div>
          <div class="bar"><span></span></div>
        </div>
      </div>
    </div>
  </section>

  <section class="band">
    <div class="wrap">
      <div class="own">
        <div class="copy">
          <h2>It's your memory. Not ours.</h2>
          <p>We keep it safe and share it only with the AI apps you pick.</p>
          ${site.source ? html`<p>Don't take our word for it: <a href="${site.source}">Context is open source</a>, so you can read exactly what happens to your memories.</p>` : ""}
        </div>
        <ul>
          <li>${icon("lock")}<div><b>We never sell it</b><span>No ads, and never used to train AI.</span></div></li>
          <li>${icon("key")}<div><b>You choose who gets in</b><span>No AI app can see it until you say yes.</span></div></li>
          <li>${icon("box")}<div><b>Take it with you</b><span>Download a copy any time.</span></div></li>
          <li>${icon("bin")}<div><b>Gone means gone</b><span>Delete one memory, or everything.</span></div></li>
        </ul>
      </div>
    </div>
  </section>

  <section class="band" id="pricing">
    <div class="wrap">
      <div class="section-head"><h2>Free for most people. Pro if you want more.</h2></div>
      <div class="toggle" role="group" aria-label="How often you pay">
        <button type="button" id="bill-month" aria-pressed="true">Monthly</button>
        <button type="button" id="bill-year" aria-pressed="false">Yearly <span class="save">save 20%</span></button>
      </div>
      <div class="plans">
        <div class="plan">
          <h3>Free</h3>
          <div class="price">$0 <small>forever</small></div>
          <ul>
            <li>No limit on memories</li>
            <li>Works with all your AI apps</li>
            <li>See, fix and confirm what AI saved</li>
            <li>Bring in, search and download</li>
            <li class="off">Changes can't be undone</li>
          </ul>
          <a class="btn btn-ghost" href="/login">Start free</a>
        </div>
        <div class="plan pro">
          <h3>Pro <span class="hand" style="font-size:1.2rem">for power users</span></h3>
          <div class="price"><span id="price">$5</span> <small id="per">a month</small></div>
          <ul>
            <li>Everything in Free</li>
            <li>Undo any change, get back anything deleted</li>
            <li>Search by meaning, not only words</li>
            <li>Weekly cleanup of repeats and old facts</li>
            <li>Daily backups to your Google Drive</li>
            <li>API keys for scripts and AI tools</li>
          </ul>
          <a class="btn btn-primary" href="/login?next=/account">Get Pro</a>
          <p class="gift">Or get it free: <a href="/invite">invite a friend</a></p>
        </div>
      </div>
      <p class="fine">Prices include tax. Cancel any time and keep your memories. For personal use, up to ${MAX} memories.</p>
      ${trustBox(site.source)}
    </div>
  </section>

  <section class="band">
    <div class="wrap">
      <div class="section-head"><h2>Questions</h2></div>
      <div class="faq">
        <details><summary>Which AI apps work with Context?</summary>
          <p>ChatGPT, Claude, Gemini and Grok. Some of them only allow it on their paid plans.</p></details>
        <details><summary>How do I set it up?</summary>
          <p>Sign in with Google, then add Context to each AI app. It takes a few minutes, and we show you each step.</p></details>
        <details><summary>Who can see my memories?</summary>
          <p>Only you, and the AI apps you said yes to.</p></details>
        ${site.source
          ? html`<details><summary>Is Context open source?</summary>
              <p>Yes. <a href="${site.source}">The code is on GitHub</a>, so you can check how your memories are handled, and <a href="/version">/version</a> shows which version is running now. You can also run your own copy for yourself.</p></details>`
          : ""}
        <details><summary>Is it really free?</summary>
          <p>Yes. Free has no limit for normal use. Pro adds undo, search by meaning, weekly cleanup, Drive backups and API keys.</p></details>
        <details><summary>How do invites work?</summary>
          <p>Share your link. When a friend joins and adds their first AI app, you both get a month of Pro free.</p></details>
        <details><summary>What if I stop paying for Pro?</summary>
          <p>You keep all your memories. Old versions go after 30 days, backups and cleanup stop, and API keys stop working.</p></details>
      </div>
    </div>
  </section>

  <section class="band">
    <div class="wrap">
      <div class="final">
        ${Crab("waving")}
        <div>
          <h2>Tell your AI who you are. One last time.</h2>
          <p>Set it up once. Every AI knows you from day one.</p>
          <div class="hero-cta">
            <a class="btn btn-primary" href="/login">Get started free</a>
            <small>By signing in you agree to the <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</small>
          </div>
        </div>
      </div>
    </div>
  </section>
</main>
<script>
  // The relay demo is fully visible at rest; playing hides the steps and shows them in order.
  const relay = document.getElementById("relay");
  const steps = [...relay.querySelectorAll("[data-step]")].sort((a, b) => a.dataset.step - b.dataset.step);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let timers = [];
  function play() {
    if (reduced) return;
    timers.forEach(clearTimeout);
    steps.forEach((s) => s.classList.remove("on"));
    relay.classList.add("playing");
    timers = [300, 1200, 2000, 2600, 3800, 4600, 5300].map((d, i) => setTimeout(() => steps[i].classList.add("on"), d));
    timers.push(setTimeout(() => relay.classList.remove("playing"), 6200));
  }
  document.getElementById("replay").addEventListener("click", play);
  if ("IntersectionObserver" in window) {
    const seen = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) { seen.disconnect(); play(); }
    }, { threshold: 0.45 });
    seen.observe(relay);
  }
  // Monthly or yearly Pro price.
  const month = document.getElementById("bill-month"), year = document.getElementById("bill-year");
  function setBilling(yearly) {
    month.setAttribute("aria-pressed", String(!yearly));
    year.setAttribute("aria-pressed", String(yearly));
    document.getElementById("price").textContent = yearly ? "$48" : "$5";
    document.getElementById("per").textContent = yearly ? "a year ($4 a month)" : "a month";
  }
  month.addEventListener("click", () => setBilling(false));
  year.addEventListener("click", () => setBilling(true));
</script>`,
    { landing: true, meta: { description: DEFAULT_DESCRIPTION, path: "/" } }
  );
}

// Plain answers next to sign-up. Each line must stay true to the code and /privacy:
// we store memories, the sign-in email and which apps you allowed; export and account
// deletion (which also cuts off every app) are on the Account page.
function trustBox(source?: string): Html {
  return html`<div class="trust" aria-label="Your data, in plain words">
    <div><b>What we store</b><span>The memories you and your AI apps save, the email you sign in with, and which AI apps you allowed.</span></div>
    <div><b>Who can read it</b><span>Only you, and the AI apps you say yes to. We don't sell it or use it to train AI.</span></div>
    <div><b>How to leave</b><span>Download all your memories any time. Delete your account and everything goes, and your AI apps lose access.</span></div>
    <div><b>Your Google account</b><span>You sign in with Google, and Context only receives your email address. On Pro, you can also let it save backups to your Google Drive, where it can only see the files it creates.</span></div>
    <p class="trust-more"><a href="/privacy#google">Read the privacy policy</a>${source ? html` · <a href="${source}">Read the code</a>` : ""}</p>
  </div>`;
}

// --- What does your AI think about you? (public, no sign-up) ------------------------

export function whatAiKnowsPage(prompt: string): Html {
  const description = "Copy one message into ChatGPT, Claude or Gemini and see what it thinks it knows about you. Free, no sign-up.";
  return layout(
    "What does your AI think about you? | Context",
    html`<div class="wak-hero">
        ${Crab("curious", "A curious hermit crab")}
        <div>
          <h1>What does your AI think about you?</h1>
          <p class="lead">Your AI has been taking notes. Ask it to show you. Some of it is right. Some of it is a guess.</p>
        </div>
      </div>
      <ol class="steps" style="margin-top:28px">
        <li><div>
          <p>Copy this message.</p>
          <div class="row" style="margin-top:12px"><button class="btn btn-primary" type="button" data-copy="prompt">Copy the message</button></div>
          <pre id="prompt">${prompt}</pre>
        </div></li>
        <li><div><p>Paste it into ChatGPT, Claude or Gemini. Use the one you talk to most.</p></div></li>
        <li><div>
          <p>Read what it thinks it knows. Lines marked <span class="tag said">said</span> are things you told it. Lines marked <span class="tag assumed">inferred</span> are things it only guessed.</p>
        </div></li>
      </ol>
      <div class="panel wak-example" aria-label="An example answer">
        <div class="memcard"><div>Lives in Leeds and works in marketing.</div><div class="meta"><span class="tag said">you said</span></div></div>
        <div class="memcard"><div>Likes short answers. Hates bullet points.</div><div class="meta"><span class="tag said">you said</span></div></div>
        <div class="memcard focus"><div>Probably a night owl. Often asks for help after midnight.</div><div class="meta"><span class="tag assumed">AI guessed</span></div></div>
        <div class="memcard focus"><div>Seems to be planning a wedding.</div><div class="meta"><span class="tag assumed">AI guessed</span></div></div>
      </div>
      <p class="hand wak-shot">Screenshot it. Send it to a friend. Ask them what it got wrong.</p>
      <div class="final wak-cta">
        ${Crab("happy")}
        <div>
          <h2>Keep it, fix what's wrong, and take it to every AI.</h2>
          <p>Paste the answer into Context. Fix the bad guesses. Then ChatGPT, Claude, Gemini and Grok all know the real you.</p>
          <div class="hero-cta">
            <a class="btn btn-primary" href="/login">Get started</a>
            <small>Free. Sign in with Google.</small>
          </div>
        </div>
      </div>`,
    { current: "/what-ai-knows", meta: { description, path: "/what-ai-knows" } }
  );
}

// --- Guides and blog -----------------------------------------------------------------

const KIND = {
  guide: { path: "/guides", name: "Guides", lead: "Short, plain how-tos for getting more out of your AI apps." },
  post: { path: "/blog", name: "Blog", lead: "News and thoughts from the Context team." }
} as const;

const isoDay = (day: string) => formatDate(`${day}T00:00:00Z`);

export function articleIndexPage(kind: Article["kind"], articles: Article[]): Html {
  const k = KIND[kind];
  return layout(
    `${k.name} | Context`,
    html`<h1>${k.name}</h1>
      <p class="lead">${k.lead}</p>
      ${articles.length === 0
        ? html`<div class="empty">${Crab("sleeping")}<p class="lead">Nothing here yet. Check back soon.</p></div>`
        : html`<ul class="article-list">
            ${articles.map(
              (a) => html`<li><a href="${articlePath(a)}"><h2>${a.title}</h2><p>${a.description}</p><time datetime="${a.published}">${isoDay(a.published)}</time></a></li>`
            )}
          </ul>`}`,
    { current: k.path, meta: { description: `${k.name} from Context. ${k.lead}`, path: k.path } }
  );
}

export function articlePage(a: Article): Html {
  const k = KIND[a.kind];
  const path = articlePath(a);
  return layout(
    `${a.title} | Context`,
    html`<article class="prose">
        <p class="article-kicker"><a href="${k.path}">${k.name}</a></p>
        <h1>${a.title}</h1>
        <p class="article-date">
          <time datetime="${a.published}">${isoDay(a.published)}</time>${a.updated && a.updated !== a.published
            ? html` · Updated <time datetime="${a.updated}">${isoDay(a.updated)}</time>`
            : ""}
        </p>
        ${raw(a.body)}
      </article>
      <div class="article-cta">
        ${Crab("waving")}
        <div>
          <h2>One memory for all your AI apps.</h2>
          <p>Tell ChatGPT something once, and Claude, Gemini and Grok know it too.</p>
          <a class="btn btn-primary" href="/login">Try Context free</a>
        </div>
      </div>`,
    {
      current: k.path,
      meta: {
        description: a.description,
        path,
        type: "article",
        jsonLd: {
          "@context": "https://schema.org",
          "@type": "Article",
          headline: a.title,
          description: a.description,
          datePublished: a.published,
          dateModified: a.updated ?? a.published,
          mainEntityOfPage: `${SITE_URL}${path}`,
          author: { "@type": "Organization", name: "Context", url: SITE_URL },
          publisher: { "@type": "Organization", name: "Context", url: SITE_URL }
        }
      }
    }
  );
}

// --- Memories -------------------------------------------------------------------

export function memoriesPage(
  memories: Memory[],
  opts: { query?: string; total?: number; invite?: InviteNote; cleanupCount?: number; setup?: SetupState } = {}
): Html {
  const query = opts.query ?? "";
  const total = opts.total ?? memories.length;
  if (total === 0 && opts.setup) {
    return layout(
      "Your Context",
      html`<h1>Let's set up Context</h1>
        ${setupChecklist(opts.setup, "Four short steps. Each one ticks itself off when it's done.")}
        ${opts.invite?.justConnected ? inviteNote(opts.invite) : ""}`,
      { signedIn: true, current: "/" }
    );
  }
  if (total === 0) {
    return layout(
      "Your Context",
      html`<div class="empty">
          ${Crab("curious")}
          <h1>Nothing here yet</h1>
          <p class="lead">Bring in what your AI already knows, or add an AI app and start chatting.</p>
          <div class="row">
            <a class="btn btn-primary" href="/import">Bring in my memories</a>
            <a class="btn btn-ghost" href="/connect">Add an AI app</a>
          </div>
        </div>
        ${opts.invite?.justConnected ? inviteNote(opts.invite) : ""}`,
      { signedIn: true, current: "/" }
    );
  }
  const sections = CATEGORIES.map((cat) => {
    const items = memories.filter((m) => m.category === cat);
    if (items.length === 0) return "";
    return html`<section><details class="category" data-category="${cat}" open>
      <summary><h2>${CATEGORY_LABELS[cat]} <small>${items.length}</small></h2></summary>
      ${items.map(memoryCard)}
    </details></section>`;
  });
  return layout(
    "Your Context",
    html`${opts.setup ? setupChecklist(opts.setup) : ""}
      ${opts.invite?.justConnected ? inviteNote(opts.invite) : ""}
      ${opts.cleanupCount
        ? html`<p class="note">Cleanup found ${opts.cleanupCount} thing${opts.cleanupCount === 1 ? "" : "s"} to tidy up. <a href="/cleanup">Review</a></p>`
        : ""}
      <h1>What your AI knows about you</h1>
      <form class="search" method="get" action="/" role="search">
        <input type="search" name="q" value="${query}" placeholder="Search your memories" aria-label="Search your memories" maxlength="200">
        <button class="btn btn-primary btn-small">Search</button>
      </form>
      ${query
        ? html`<p class="muted"><span id="count">${memories.length}</span> of ${total} memories match “${query}”. <a href="/">Clear</a></p>`
        : html`<p class="muted"><span id="count">${memories.length}</span> memories. Check the ones marked “AI guessed”.</p>`}
      <p class="muted" style="font-size:.9rem;margin-top:6px"><a href="/export/memories.md" download>Download a copy</a></p>
      ${query && memories.length === 0 ? html`<p style="margin-top:20px">Nothing matches. Try fewer or shorter words.</p>` : ""}
      ${sections}
      ${opts.invite && !opts.invite.justConnected ? inviteNote(opts.invite) : ""}
      <script>
        // Send card actions in the background so the page doesn't reload and lose your scroll position.
        // Without JavaScript the forms still work as normal posts.
        document.addEventListener("submit", async (e) => {
          const card = e.target.closest(".card[data-memory]");
          if (!card) return;
          e.preventDefault();
          const res = await fetch(e.target.action, { method: "POST", body: new FormData(e.target), headers: { "X-Fragment": "1" } });
          if (!res.ok) return location.reload();
          if (res.status === 204) {
            const section = card.closest("section");
            card.remove();
            const left = section?.querySelectorAll(".card").length;
            if (section && !left) section.remove();
            else if (section) section.querySelector("summary small").textContent = left;
            const count = document.getElementById("count");
            count.textContent = Number(count.textContent) - 1;
          } else {
            card.outerHTML = await res.text();
          }
        });

        // Cancel closes the edit box; opening it puts the cursor at the end of the text.
        document.addEventListener("click", (e) => {
          if (e.target.matches("[data-close]")) e.target.closest("details").open = false;
        });
        document.addEventListener("toggle", (e) => {
          if (!e.target.matches?.("details.edit") || !e.target.open) return;
          const box = e.target.querySelector("textarea");
          box.focus();
          box.setSelectionRange(box.value.length, box.value.length);
        }, true);

        // Categories you fold stay folded next time (except when searching, so matches show).
        const FOLDED = "context-folded";
        const read = () => { try { return JSON.parse(localStorage.getItem(FOLDED) || "[]"); } catch { return []; } };
        if (!new URLSearchParams(location.search).get("q")) {
          const folded = read();
          document.querySelectorAll("details.category").forEach((d) => { if (folded.includes(d.dataset.category)) d.open = false; });
        }
        document.addEventListener("toggle", (e) => {
          const d = e.target;
          if (!d.matches?.("details.category")) return;
          const folded = read().filter((c) => c !== d.dataset.category);
          if (!d.open) folded.push(d.dataset.category);
          try { localStorage.setItem(FOLDED, JSON.stringify(folded)); } catch {}
        }, true);
      </script>`,
    { signedIn: true, current: "/" }
  );
}

export interface InviteNote {
  link: string;
  /** Shown once, at the top, after the user connects their first AI app. Otherwise a small card at the bottom. */
  justConnected: boolean;
}

function inviteNote(invite: InviteNote): Html {
  return html`<div class="note" style="margin:${invite.justConnected ? "0 0 24px" : "28px 0 0"}">
    <p>${invite.justConnected ? html`<b>You're connected.</b> ` : ""}Invite a friend. You both get a month of Pro free. <a href="/invite">How it works</a></p>
    <div class="copy-row"><code id="invite-link">${invite.link}</code><button class="btn btn-ghost btn-small" type="button" data-copy="invite-link">Copy link</button></div>
  </div>`;
}

export function memoryCard(m: Memory): Html {
  return html`<div class="card" data-memory="${m.id}">
    <div class="memory-text">${m.content}</div>
    <div class="meta">
      ${m.explicit ? "" : html`<span class="tag assumed">AI guessed</span>`}
      <span>Saved by ${m.source}</span>
      ${m.edited_by ? html`<span>Changed by ${m.edited_by === "You" ? "you" : m.edited_by}</span>` : ""}
      <span>${formatDate(m.updated_at)}</span>
    </div>
    <div class="meta actions">
      ${m.explicit
        ? ""
        : html`<form class="inline" method="post" action="/memories/${m.id}/confirm"><button>Confirm</button></form>`}
      <details class="edit">
        <summary>Edit</summary>
        <form class="edit-form" method="post" action="/memories/${m.id}/edit">
          <textarea name="content" rows="3" required maxlength="500" aria-label="Memory">${m.content}</textarea>
          <div class="edit-row">
            <label class="field">Category
              <select name="category">
                ${CATEGORIES.map(
                  (c) => html`<option value="${c}" ${c === m.category ? "selected" : ""}>${CATEGORY_LABELS[c]}</option>`
                )}
              </select>
            </label>
            <div class="row">
              <button class="btn btn-ghost btn-small" type="button" data-close>Cancel</button>
              <button class="btn btn-primary btn-small">Save</button>
            </div>
          </div>
        </form>
      </details>
      <form class="inline" method="post" action="/memories/${m.id}/forget"><button>Forget</button></form>
    </div>
  </div>`;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

// --- Import ---------------------------------------------------------------------

export function importPage(prompt: string): Html {
  return layout(
    "Import",
    html`<h1>Bring in what your AI knows</h1>
      <p class="lead">Two quick steps.</p>
      <ol class="steps" style="margin-top:24px">
        <li><div>
          <p>Send this message to the AI app that knows you best, like ChatGPT:</p>
          <pre id="prompt">${prompt}</pre>
          <button class="btn btn-ghost btn-small" type="button" data-copy="prompt">Copy message</button>
        </div></li>
        <li><div>
          <p>Copy its answer and paste it here. If it says there's more, reply “continue” and paste that too.</p>
          <form method="post" action="/import" class="stack" style="margin-top:12px">
            <label>It came from
              <select name="source">
                <option>ChatGPT</option><option>Claude</option><option>Gemini</option><option>Other</option>
              </select>
            </label>
            <textarea name="text" required aria-label="Pasted memories" placeholder="[preferences] [said] [2024-03-02] Prefers concise answers..."></textarea>
            <div><button class="btn btn-primary">Bring them in</button></div>
          </form>
        </div></li>
      </ol>`,
    { signedIn: true, current: "/import" }
  );
}

export function importResultPage(saved: number, skipped: string[], limitNote?: string): Html {
  return layout(
    "Imported",
    html`<div class="empty">
        ${Crab(saved > 0 ? "happy" : "confused")}
        <h1>${saved > 0 ? html`Brought in ${saved} memor${saved === 1 ? "y" : "ies"}` : "Nothing was brought in"}</h1>
      </div>
      ${limitNote ? html`<p class="warn">Some lines weren't brought in. ${limitNote}</p>` : ""}
      ${skipped.length
        ? html`<p class="muted" style="margin-top:16px">${skipped.length} line(s) couldn't be read, so they were skipped:</p>
            <pre>${skipped.join("\n")}</pre>`
        : ""}
      <p style="margin-top:20px"><a class="btn btn-primary" href="/">See your memories</a></p>`,
    { signedIn: true, current: "/import" }
  );
}

// --- Connect --------------------------------------------------------------------

export type AppId = "claude" | "chatgpt" | "gemini" | "grok";

interface AppGuide {
  id: AppId;
  /** Matches the label sourceLabel() records for this app in user_apps. */
  name: string;
  steps: string[];
  note?: string;
  /** A short screen recording in public/videos/, shown next to the steps once it exists. */
  video?: string;
}

export const APP_GUIDES: AppGuide[] = [
  {
    id: "claude",
    name: "Claude",
    steps: [
      "In Claude, open Customize, then Connectors.",
      "Click + Add, then Add custom connector.",
      "Paste your Context link. Keep the recommended sign-in option, then click Add, then Connect.",
      "Claude sends you to Context. Click Allow."
    ]
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    steps: [
      "In ChatGPT, open Settings, then Apps & Connectors, then Advanced.",
      "Turn on Developer mode.",
      "Click Create, paste your Context link and choose OAuth.",
      "Click Connect. ChatGPT sends you to Context. Click Allow."
    ]
  },
  {
    id: "gemini",
    name: "Gemini",
    steps: [
      "In Gemini, open Customize, then Connectors, then Custom.",
      "Paste your Context link. Leave the client ID and secret empty, then click Next.",
      "Accept the warning. Gemini sends you to Context. Click Allow."
    ],
    note: "Works with personal Google accounts only."
  },
  {
    id: "grok",
    name: "Grok",
    steps: [
      "Go to grok.com/connectors.",
      "Click New Connector, then Custom, and paste your Context link.",
      "Grok sends you to Context. Click Allow."
    ],
    note: "Needs a paid Grok plan."
  }
];

export const appGuide = (id: string | undefined) => APP_GUIDES.find((a) => a.id === id);

const mcpLink = (mcpUrl: string, id = "mcp-address") =>
  html`<div class="copy-row"><code id="${id}">${mcpUrl}</code><button class="btn btn-ghost btn-small" type="button" data-copy="${id}">Copy link</button></div>`;

function guideSteps(app: AppGuide): Html {
  return html`<ol class="app-steps">${app.steps.map((step) => html`<li>${step}</li>`)}</ol>
    ${app.note ? html`<p class="muted" style="font-size:.92rem">${app.note}</p>` : ""}
    ${app.video ? html`<video src="${app.video}" controls muted playsinline preload="metadata" aria-label="How to add Context to ${app.name}"></video>` : ""}`;
}

/** One app's steps, with the link to copy first. */
function oneAppGuide(app: AppGuide, mcpUrl: string): Html {
  return html`<div class="app-guide">
    <p>Copy your Context link:</p>
    ${mcpLink(mcpUrl)}
    ${guideSteps(app)}
  </div>`;
}

/** App buttons. Each links to `base?app=<id>`, which shows that app's steps. */
function appPicker(base: string, chosen?: AppId, skip: string[] = []): Html {
  return html`<div class="picker" role="list">
    ${APP_GUIDES.filter((a) => !skip.includes(a.name)).map(
      (a) => html`<a role="listitem" href="${base}?app=${a.id}#setup" aria-current="${a.id === chosen ? "true" : "false"}">${a.name}</a>`
    )}
  </div>`;
}

// The public docs: every app, one after another.
function connectSteps(mcpUrl: string): Html {
  return html`<p>Copy your Context link, then follow the steps for your app.</p>
      ${mcpLink(mcpUrl)}
      ${APP_GUIDES.map((a) => html`<h3>${a.name}</h3>${guideSteps(a)}`)}`;
}

export function connectPage(mcpUrl: string, chosen?: AppId): Html {
  const app = appGuide(chosen);
  return layout(
    "Connect",
    html`<h1 id="setup">Add Context to an AI app</h1>
      <p class="lead">Pick the app. You do this once for each AI app you use.</p>
      ${appPicker("/connect", chosen)}
      ${app ? oneAppGuide(app, mcpUrl) : ""}
      <h2 id="always">Make it check Context every time</h2>
      <p class="muted">Optional. Paste this into the app's personal settings. In Claude: Settings → Profile. In ChatGPT: Settings → Personalization → Custom instructions.</p>
      <pre id="instructions">${ASSISTANT_INSTRUCTIONS}</pre>
      <button class="btn btn-ghost btn-small" type="button" data-copy="instructions">Copy instructions</button>
      <h2>Then try it</h2>
      <p class="muted">Ask: “${TRY_IT}” At the end of a good chat, say “Sync Context”.</p>`,
    { signedIn: true, current: "/connect" }
  );
}

// --- Setup checklist (home page, until done or hidden) ------------------------------

export const TRY_IT = "What do you know about me? Check Context.";

export interface SetupState {
  /** Connected apps, oldest first, and whether each has made a tool call. */
  apps: { app: string; used: boolean }[];
  memories: number;
  chosen?: AppId;
  mcpUrl: string;
}

/** Changes whenever a step's state does; the page reloads when it differs on return. */
export const setupSignature = (s: Pick<SetupState, "apps" | "memories">) =>
  `${s.apps.length}.${s.apps.filter((a) => a.used).length}.${s.memories > 0 ? 1 : 0}`;

export const setupDone = (s: Pick<SetupState, "apps" | "memories">) =>
  s.apps.length >= 2 && s.memories > 0 && s.apps.some((a) => a.used);

/** "I've done this": checks at once, and explains what to look at if the step hasn't happened yet. */
const doneCheck = (waiting: string) =>
  html`<div class="done-check">
    <button class="btn btn-primary btn-small" type="button" data-check>I've done this</button>
    <p class="done-wait" hidden>${waiting} This page updates by itself once it has.</p>
  </div>`;

/** `intro` replaces the card's title when the page itself is the setup page (an empty account). */
function setupChecklist(s: SetupState, intro?: string): Html {
  const first = s.apps[0]?.app;
  const chosenApp = appGuide(s.chosen);
  const steps = [
    {
      done: s.apps.length > 0,
      title: "Connect the AI app you use most",
      doneTitle: html`Connected ${first}`,
      body: html`${appPicker("/", s.chosen)}${chosenApp
        ? html`${oneAppGuide(chosenApp, s.mcpUrl)}${doneCheck(`We haven't seen ${chosenApp.name} connect yet. Make sure you clicked Allow on the Context page it opened.`)}`
        : ""}`
    },
    {
      done: s.memories > 0,
      title: "Bring in what it already knows",
      doneTitle: html`${s.memories} memor${s.memories === 1 ? "y" : "ies"} saved`,
      body: html`<p>Send one message to your AI app and paste its answer back. About 30 seconds, and your AI apps know you from the start.</p>
        <a class="btn btn-primary btn-small" href="/import">Bring in my memories</a>`
    },
    {
      done: s.apps.some((a) => a.used),
      title: "Try it",
      doneTitle: html`It works`,
      body: html`<p>Send this to ${first ?? "your AI app"} in a new chat. If it asks to use Context, allow it.</p>
        <div class="copy-row"><code id="try-it">${TRY_IT}</code><button class="btn btn-ghost btn-small" type="button" data-copy="try-it">Copy</button></div>
        <p class="muted" style="font-size:.92rem">Want it to check Context in every chat? <a href="/connect#always">Add one line to its settings</a>.</p>
        ${doneCheck(`We haven't seen ${first ?? "your AI app"} use Context yet. Start a new chat, send the message, and allow Context if it asks.`)}`
    },
    {
      done: s.apps.length >= 2,
      title: "Add a second AI app",
      doneTitle: html`${s.apps.length} AI apps share one memory`,
      body: html`<p>This is where it pays off: tell one app something, then ask the other.</p>
        ${appPicker("/", s.chosen, s.apps.map((a) => a.app))}${chosenApp && s.apps.length > 0 && !s.apps.some((a) => a.app === chosenApp.name)
          ? html`${oneAppGuide(chosenApp, s.mcpUrl)}${doneCheck(`We haven't seen ${chosenApp.name} connect yet. Make sure you clicked Allow on the Context page it opened.`)}`
          : ""}`
    }
  ];
  const current = steps.findIndex((step) => !step.done);
  const doneCount = steps.filter((step) => step.done).length;
  return html`<section class="setup" id="setup" data-sig="${setupSignature(s)}" aria-label="Set up Context">
    <div class="setup-head">
      ${intro ? html`<p>${intro}</p>` : html`<h2>Get set up</h2>`}
      <span class="setup-progress">${doneCount} of ${steps.length} done</span>
    </div>
    <ol class="tasks">
      ${steps.map(
        (step, i) => html`<li class="${step.done ? "done" : ""}">
          <details ${i === current ? "open" : ""}>
            <summary><span class="num">${step.done ? "✓" : i + 1}</span><span>${step.done ? step.doneTitle : step.title}</span></summary>
            ${step.done ? "" : html`<div class="task-body">${step.body}</div>`}
          </details>
        </li>`
      )}
    </ol>
    <form method="post" action="/setup/hide" class="setup-hide"><button>Hide this</button></form>
    <script>
      // Steps finish in another app, so the page asks whether anything changed and reloads when it
      // did: on coming back (tab shown or window focused), every 5 seconds for 15 minutes, and when
      // the user presses "I've done this", which also says what to check if nothing changed yet.
      const sig = document.getElementById("setup").dataset.sig;
      let busy = false;
      async function check(button) {
        if (busy) return;
        busy = true;
        try {
          const res = await fetch("/setup/status", { cache: "no-store" });
          if (res.ok && (await res.text()) !== sig) return location.reload();
          if (button) button.closest(".done-check").querySelector(".done-wait").hidden = false;
        } catch {} finally { busy = false; }
      }
      document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
      addEventListener("focus", () => check());
      const started = Date.now();
      const timer = setInterval(() => {
        if (Date.now() - started > 15 * 60_000) return clearInterval(timer);
        if (!document.hidden) check();
      }, 5000);
      document.addEventListener("click", (e) => {
        const button = e.target.closest("[data-check]");
        if (button) check(button);
      });
    </script>
  </section>`;
}

// Pasted by the user into each assistant's custom instructions. Unlike our MCP server
// instructions, every app is guaranteed to show these to the model in every conversation.
export const ASSISTANT_INSTRUCTIONS = `I use Context (keepyourcontext.com) as my long-term memory across all my AI assistants. At the start of every conversation, call get_context from the Context connector before answering. Call search_context whenever my background, projects, preferences, people or past decisions could matter. Treat Context as more up to date than your own memory. When I tell you something lasting about myself, save it with remember.`;

/** `here` is this /authorize URL (path and query), so "Not you?" can sign out and come back to it. */
export function consentPage(client: ClientInfo, request: AuthRequest, handle: string, email: string, here: string): Html {
  const redirectHost = new URL(request.redirectUri).hostname;
  const local = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/.test(redirectHost);
  const name = client.clientName ?? client.clientId;
  const verified = client.clientId.startsWith("https://")
    ? html`Published by <strong>${new URL(client.clientId).hostname}</strong>.`
    : html`This app registered itself; its name is not verified.`;
  return layout(
    `Allow ${name}?`,
    html`<div class="empty">${Crab("curious")}</div>
      <h1>Let ${name} use your Context?</h1>
      <p>It will be able to read, add, change and forget memories for <strong>${email}</strong>.</p>
      <p class="muted">${verified} Access will be sent to <strong>${redirectHost}</strong>.</p>
      ${local
        ? html`<p class="warn">This sends access to an app on your computer. Only continue if you just started connecting from it.</p>`
        : ""}
      <form method="post" action="/authorize" style="margin-top:24px">
        <input type="hidden" name="handle" value="${handle}">
        <div class="row">
          <button class="btn btn-primary" name="decision" value="approve">Allow</button>
          <button class="btn btn-ghost" name="decision" value="deny">Deny</button>
        </div>
      </form>
      <form method="post" action="/logout" style="margin-top:16px">
        <input type="hidden" name="next" value="${here}">
        <p class="muted">Not ${email}? <button>Use another account</button></p>
      </form>`,
    { signedIn: true }
  );
}

export function errorPage(message: string): Html {
  return layout(
    "Something went wrong",
    html`<div class="empty">${Crab("confused")}<h1>Something went wrong</h1><p class="lead">${message}</p>
      <a class="btn btn-ghost" href="/">Back to Context</a></div>`
  );
}

export function notFoundPage(signedIn: boolean): Html {
  return layout(
    "Page not found",
    html`<div class="empty">${Crab("confused")}<h1>We couldn't find that page</h1>
      <p class="lead">The link may be old, or there may be a typo in it.</p>
      <a class="btn btn-primary" href="/">${signedIn ? "Back to your memories" : "Go to the home page"}</a></div>`,
    { signedIn }
  );
}

// --- Invite ---------------------------------------------------------------------

export function invitePage(link: string, stats: ReferralStats): Html {
  const left = Math.max(0, MAX_REFERRAL_REWARDS - stats.rewarded);
  return layout(
    "Invite friends",
    html`<div class="empty">${Crab("waving")}</div>
      <h1>Invite a friend. You both get a month of Pro free.</h1>
      <p class="lead">Send this link. When your friend joins and adds an AI app, you both get a month free.</p>
      <div class="copy-row"><code id="invite-link">${link}</code><button class="btn btn-primary btn-small" type="button" data-copy="invite-link">Copy link</button></div>
      <div class="stats">
        <div><b>${stats.joined}</b><span>friends joined</span></div>
        <div><b>${stats.rewarded}</b><span>free months earned</span></div>
        <div><b>${left}</b><span>free months left to earn</span></div>
      </div>
      <h2>How it works</h2>
      <ol class="steps">
        <li><div>Your friend opens your link and signs up.</div></li>
        <li><div>They add Context to their first AI app, like ChatGPT or Claude.</div></li>
        <li><div>You both get 30 days of Pro. Already paying? Your free days wait until you stop.</div></li>
      </ol>
      <p class="muted" style="margin-top:20px;font-size:.9rem">Up to ${MAX_REFERRAL_REWARDS} free months. <a href="/terms">Terms</a> apply.</p>`,
    { signedIn: true, current: "/invite" }
  );
}

// --- Public pages: docs, legal, support ------------------------------------------
// Directory listings link to these, so they must work without signing in.

export function docsPage(site: Site): Html {
  return layout(
    "How Context works",
    html`<div class="legal">
      <h1>How Context works</h1>
      <p>Context is one long-term memory that all your AI assistants share. Tell Claude something about yourself and ChatGPT, Gemini and Grok can know it too. You own the memory: you can see, edit, export and delete everything on this site.</p>
      <h2>Getting started</h2>
      <ol>
        <li><a href="/login">Sign in with Google</a>.</li>
        <li>If you like, bring in what your current assistant already knows about you from the Import page.</li>
        <li>Add Context to each assistant you use (below), and approve it when it sends you here.</li>
      </ol>
      <h2>Connect your assistants</h2>
      ${connectSteps(site.mcpUrl)}
      <h2>What assistants can do</h2>
      <ul>
        <li><strong>Get Context overview</strong> and <strong>Search Context</strong>: read your memories, starting with any standing instructions you've given.</li>
        <li><strong>Remember</strong>: save new lasting facts, such as a preference, a project update or a decision.</li>
        <li><strong>Update memory</strong> and <strong>Merge memories</strong>: replace a fact that changed, or combine duplicates. On Pro, old versions are kept in your history.</li>
        <li><strong>Forget memory</strong>: remove a memory when you ask.</li>
      </ul>
      <p>Assistants are told not to save health details, passwords, secrets or one-off tasks.</p>
      <h2>Plans</h2>
      <ul>
        <li><strong>Free:</strong> no set limit on memories for personal use (fair use is up to ${MAX}). Edits replace the old version and forgotten memories are deleted for good.</li>
        <li><strong>Pro</strong> (${PRO_PRICE_LABEL.month} or ${PRO_PRICE_LABEL.year}): everything in Free, plus:
          <ul>
            <li><strong>Full history:</strong> every edited, merged or forgotten memory is kept, and you can restore any of them from the History page.</li>
            <li><strong>Search by meaning:</strong> your AI apps find memories that match what you mean, not only the words you used. A search for “dinner ideas” finds “Is vegetarian”.</li>
            <li><strong>Automatic cleanup:</strong> once a week, Context suggests combining memories that repeat each other and forgetting ones that are out of date. You approve each change, or let it combine repeats by itself.</li>
            <li><strong>Google Drive backups:</strong> a daily or weekly copy of your memories in a folder in your own Drive.</li>
            <li><strong>API keys:</strong> use Context from scripts and from AI tools that take a key (see below).</li>
          </ul>
        </li>
        <li><strong>Invites:</strong> when a friend signs up with your invite link and adds their first AI app, you both get a month of Pro free, up to ${MAX_REFERRAL_REWARDS} months.</li>
      </ul>
      <h2 id="api">API keys (Pro)</h2>
      <p>Create a key on the Account page. Memories it saves show the key's name as where they came from. Delete a key there to cut off anything using it.</p>
      <h3>In AI tools that take a key</h3>
      <p>Add Context as a remote MCP server at <code>${site.mcpUrl}</code> with the header <code>Authorization: Bearer YOUR_KEY</code>. For Claude Code:</p>
      <pre>claude mcp add --transport http context ${site.mcpUrl} --header "Authorization: Bearer YOUR_KEY"</pre>
      <h3>From scripts</h3>
      <p>Send the same header to the REST API at <code>${SITE_URL}/api/v1</code>. Requests and responses are JSON.</p>
      <ul>
        <li><code>GET /memories</code>: every memory (add <code>?category=projects</code> for one category).</li>
        <li><code>GET /search?q=weekend plans&amp;limit=10</code>: search by meaning and words.</li>
        <li><code>POST /memories</code> with <code>{"memories": [{"content": "Prefers window seats.", "category": "preferences"}]}</code>: save up to 100 at once. Add <code>"said_by_user": false</code> for a guess.</li>
        <li><code>PATCH /memories/ID</code> with any of <code>content</code>, <code>category</code>, <code>said_by_user</code>: change one.</li>
        <li><code>POST /memories/merge</code> with <code>{"ids": ["ID1", "ID2"], "content": "..."}</code>: combine repeats.</li>
        <li><code>DELETE /memories/ID</code>: forget one.</li>
      </ul>
      <p>Categories: ${CATEGORIES.join(", ")}. Errors come back as <code>{"error", "message"}</code> with status 400, 401 (bad key), 402 (Pro has ended), 403 (limit reached), 404 or 429. Each account can make 120 requests a minute across the API and MCP; past that you get 429 with a <code>Retry-After</code> header.</p>
      <pre>curl ${SITE_URL}/api/v1/search?q=travel -H "Authorization: Bearer YOUR_KEY"</pre>
      ${site.source
        ? html`<h2 id="source">Read the code</h2>
            <p>Don't take our word for how your memories are handled: the code that runs Context is public at <a href="${site.source}">${site.source.replace(/^https:\/\//, "")}</a>, and <a href="/version">/version</a> shows the exact commit running right now. Good places to start:</p>
            <ul>
              <li><a href="${site.source}/blob/main/src/mcp.ts"><code>src/mcp.ts</code></a>: everything an AI app can ask Context to do.</li>
              <li><a href="${site.source}/blob/main/src/memories.ts"><code>src/memories.ts</code></a>: how memories are stored, edited and deleted.</li>
              <li><a href="${site.source}/blob/main/README.md#what-this-code-does-with-your-data">What this code does with your data</a>: a summary with links to the code.</li>
            </ul>
            <p>Found a security problem? See <a href="${site.source}/blob/main/SECURITY.md">SECURITY.md</a>.</p>`
        : ""}
      <h2>Your data</h2>
      <p>Export everything as JSON or Markdown from the Memories page, and delete your account and all memories from the Account page. See the <a href="/privacy">Privacy Policy</a>.</p>
      <h2>Help</h2>
      <p>Email <a href="mailto:${site.email}">${site.email}</a>.</p>
    </div>`
  );
}

export function supportPage(site: Site): Html {
  return layout(
    "Support",
    html`<div class="legal">
      <h1>Support</h1>
      <p>Email <a href="mailto:${site.email}">${site.email}</a> for help, privacy requests or to report a security issue. We aim to reply within two business days.</p>
      <h2>Common questions</h2>
      <p><strong>My assistant doesn't use Context.</strong> Check the connector is switched on for the chat, and paste the suggested custom instructions from the Connect page.</p>
      <p><strong>A memory is wrong.</strong> Edit or forget it on the Memories page, or ask your assistant to update it.</p>
      <p><strong>How do I disconnect an assistant?</strong> Remove the Context connector in that assistant's settings. Deleting your account here also revokes every assistant's access.</p>
      ${site.source
        ? html`<p><strong>Can I see how Context works?</strong> Yes, <a href="${site.source}">the code is open source</a>. Bug reports and ideas are welcome as <a href="${site.source}/issues">GitHub issues</a>; please email us instead about anything to do with your account or your data.</p>`
        : ""}
      <p>Setup guides are in the <a href="/docs">help pages</a>.</p>
    </div>`
  );
}

export function privacyPage(site: Site): Html {
  return layout(
    "Privacy Policy",
    html`<div class="legal">
      <h1>Privacy Policy</h1>
      <p class="muted">Last updated 22 November 2026. Context (keepyourcontext.com) is operated by ${site.company} ("we").</p>
      <h2>What we collect</h2>
      <ul>
        <li><strong>Account:</strong> your Google account's email address and its stable account ID, used only to sign you in. We don't receive your Google password, contacts or any other Google data.</li>
        <li><strong>Memories:</strong> the facts you or your connected AI assistants save, with their category, whether you stated them or an assistant inferred them, which assistant saved or edited them, and dates. On Pro, edited, merged and forgotten memories are kept as history in your account; on the free plan they're deleted when they change.</li>
        <li><strong>Invites:</strong> if you join through someone's invite link, we record which account invited you, so we can give you both free Pro. The link leaves a cookie with the invite code for up to 30 days. People who invite you see only how many friends joined, not who.</li>
        <li><strong>Billing (Pro only):</strong> payments are handled by Stripe, through its Link service, which is the seller of record. We never see your card details; we keep only the Stripe customer and subscription IDs needed to know your plan.</li>
        <li><strong>API keys (Pro):</strong> a name and a scrambled form (hash) of each key you create, and when it was last used. We can't read the keys themselves.</li>
        <li><strong>Google Drive backups (Pro):</strong> if you connect Google Drive, the email address of that Google account and an encrypted token that lets us add files to a folder we create. We can only see the files Context makes, never the rest of your Drive.</li>
        <li><strong>Connected assistants:</strong> which AI apps you've approved, when each last used your Context, and the access tokens they use.</li>
        <li><strong>How you found us:</strong> a short label such as "reddit.com", "invite" or "direct", taken from the link or site that brought you here. A cookie holds it for up to 30 days until you sign up. We keep only the label, never the full address.</li>
        <li><strong>Technical logs:</strong> our hosting provider keeps short-lived request logs (such as time, address and errors) to run and secure the service.</li>
      </ul>
      <h2>How we use it</h2>
      <p>Only to provide Context: to show you your memories and to give them to the AI assistants you've connected, when they ask. We don't sell your data, use it for advertising, or use it to train AI models.</p>
      <p>On Pro, two features process your memories with AI models run by Cloudflare (Workers AI) on our behalf. Search by meaning turns each memory into a list of numbers (an embedding) that we store so searches can match meaning. Weekly cleanup sends your memories to a model that suggests repeats and outdated facts. Neither is used to train models, and embeddings are deleted along with their memories.</p>
      <h2>Who it's shared with</h2>
      <ul>
        <li><strong>AI assistants you connect</strong> (for example Claude, ChatGPT, Gemini or Grok) receive memories when they read your Context. What they do with it is governed by their own privacy policies.</li>
        <li><strong>Service providers:</strong> Cloudflare hosts the service, stores the data and runs the AI models behind Pro search and cleanup; Google provides sign-in, and stores your backups in your own Drive if you connect it; Stripe processes Pro payments and receives your email address when you subscribe.</li>
        <li>Authorities, only where the law requires it.</li>
      </ul>
      <h2>How long we keep it</h2>
      <p>Until you delete it. If Pro ends (paid or free from invites), your history is kept for 30 days, then deleted (your current memories stay). Deleting your account (Account page) permanently removes your account, every memory and its history, your API keys and Drive connection, and revokes every connected assistant at once. Backups already in your Google Drive are yours, and stay there until you delete them. Copies in our provider's backups expire within 30 days.</p>
      <h2>Your rights</h2>
      <p>You can view, correct, export (JSON or Markdown) and delete your data yourself at any time. For any other request, including access, objection or questions, email <a href="mailto:${site.email}">${site.email}</a>.</p>
      <h2 id="google">Google user data</h2>
      <p>Context uses Google in two ways, and only with your permission:</p>
      <ul>
        <li><strong>Sign-in</strong> (scopes <code>openid</code> and <code>email</code>): we receive your Google account's email address and its account ID, and use them only to sign you in and to contact you about your account.</li>
        <li><strong>Google Drive backups</strong> (Pro, optional; scope <code>drive.file</code>): if you connect Google Drive, Context creates a "Context Backups" folder and writes copies of your memories there on the schedule you choose, deleting its own older backups beyond the newest 30. It can only see and change the files it creates, never anything else in your Drive. We store an encrypted token for this, and nothing from your Drive.</li>
      </ul>
      <p>We don't share Google user data with anyone, don't use it for advertising, and don't use it to train AI models. Disconnect Drive from the Account page or at <a href="https://myaccount.google.com/connections">myaccount.google.com/connections</a>; deleting your account removes everything we hold. Context's use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements.</p>
      <h2>Security</h2>
      <p>Data is encrypted in transit, each account can only reach its own memories, and assistants need your explicit approval before they can connect.</p>
      ${site.source
        ? html`<p>You don't have to take this policy on trust: the code that runs Context is public at <a href="${site.source}">${site.source.replace(/^https:\/\//, "")}</a>, and <a href="/version">/version</a> shows the exact version running now. Its README explains, file by file, <a href="${site.source}#what-this-code-does-with-your-data">what the code does with your data</a>. To report a security problem, see <a href="${site.source}/blob/main/SECURITY.md">SECURITY.md</a>.</p>`
        : ""}
      <h2>Children</h2>
      <p>Context is not intended for anyone under 16.</p>
      <h2>Changes</h2>
      <p>We'll update the date above and, for significant changes, tell you by email.</p>
      <h2>Contact</h2>
      <p>${site.company}, <a href="mailto:${site.email}">${site.email}</a>.</p>
    </div>`
  );
}

export function termsPage(site: Site): Html {
  return layout(
    "Terms of Service",
    html`<div class="legal">
      <h1>Terms of Service</h1>
      <p class="muted">Last updated 22 November 2026. These terms are between you and ${site.company} ("we"), the operator of Context (keepyourcontext.com).</p>
      <h2>The service</h2>
      <p>Context stores facts about you and makes them available to the AI assistants you connect. It is provided as is, and may change or be discontinued. We'll give reasonable notice before shutting it down so you can export your data, and refund any unused prepaid Pro time.</p>
      ${site.source
        ? html`<p>Context's source code is published at <a href="${site.source}">${site.source.replace(/^https:\/\//, "")}</a> under the <a href="${site.source}/blob/main/LICENSE.md">O'Saasy License</a>, which lets you read, change and run your own copy, but not offer it to others as a competing hosted service. These terms cover the hosted service at keepyourcontext.com.</p>`
        : ""}
      <h2>Plans and payment</h2>
      <p>Both plans are for personal use. The free plan keeps your current memories without history. Pro (${PRO_PRICE_LABEL.month} or ${PRO_PRICE_LABEL.year}, including any VAT or sales tax; prices may be shown in your local currency) also keeps your full history and adds search by meaning, weekly cleanup suggestions, Google Drive backups and personal API keys. Cleanup suggestions are made by an AI model and can be wrong, so check them before applying; applied changes can be undone from History. API keys are for your own use; keep them secret, as anyone with a key can read and change your memories. Pro is sold through Stripe's Link service, which is the seller of record and handles payment, receipts, taxes and payment support under its own terms.</p>
      <p>Pro renews automatically until you cancel. You can cancel at any time from the Account page or Link; Pro continues until the end of the period you've paid for. Afterwards your account moves to the free plan: your memories stay, your history is deleted after 30 days, and backups, cleanup and API keys stop working. Refunds follow Link's refund policy and your statutory rights.</p>
      <h2>Invites</h2>
      <p>When someone who is new to Context signs up with your invite link and approves their first AI assistant, you each get 30 days of Pro free. You can earn up to ${MAX_REFERRAL_REWARDS} periods of 30 days this way. If you already pay for Pro, your free days are saved and start when your paid subscription ends. Free Pro has no cash value and can't be exchanged or transferred. We may withhold or remove free Pro gained through fake, duplicate or automated accounts, and may change or end the invite programme, without affecting free Pro already earned honestly.</p>
      <h2>Your account</h2>
      <p>You need a Google account and must be at least 16. You're responsible for what you and your connected assistants save, and for approving only assistants you trust.</p>
      <h2>Your content</h2>
      <p>Your memories are yours. You give us permission to store them and send them to the assistants you connect, only to provide the service. Don't save other people's sensitive data without their consent, or anything illegal.</p>
      <h2>Fair use</h2>
      <p>There's no set limit on memories for normal personal use. To protect the service, an account can hold up to ${MAX} memories, and ${MAX_TOTAL_ROWS.toLocaleString("en")} including Pro history. Don't attempt to access other accounts, disrupt the service, fill it automatically with bulk data, or use it to store secrets such as passwords. We may suspend accounts that break these terms.</p>
      <h2>AI assistants</h2>
      <p>Connected assistants are third-party services with their own terms. Assistants decide what to save and can make mistakes; review your memories from time to time.</p>
      <h2>Liability</h2>
      <p>To the extent the law allows, we aren't liable for indirect or consequential losses, or for loss of data. Nothing in these terms limits liability that can't be limited by law.</p>
      <h2>Ending</h2>
      <p>You can delete your account at any time from the Account page. This also cancels any Pro subscription.</p>
      <h2>Contact</h2>
      <p><a href="mailto:${site.email}">${site.email}</a></p>
    </div>`
  );
}

// --- Account --------------------------------------------------------------------

export interface AccountInfo {
  email: string;
  /** The plan they get, counting free Pro from invites. */
  plan: Plan;
  /** Paying for Pro. */
  paid: boolean;
  /** Free Pro from invites runs until then (if in the future). */
  proUntil: string | null;
  /** Free Pro days saved while paying; they start when the paid plan ends. */
  bonusDays: number;
  active: number;
  history: number;
  historyUntil: string | null;
  /** Billing is configured (Stripe keys and prices set). */
  billing: boolean;
  /** Has a Stripe customer, so the portal can show invoices and manage the subscription. */
  canManage: boolean;
  /** Just back from a completed checkout. */
  upgraded: boolean;
  /** Pro tools (shown on Pro only). */
  keys: ApiKey[];
  /** A key that was just created, shown once. */
  newKey?: string;
  mcpUrl: string;
  backup: BackupInfo | null;
  backupsAvailable: boolean;
  cleanup: { available: boolean; auto: boolean; lastRun: string | null; pending: number };
  /** One-line result of the last action, e.g. "Backup saved to Google Drive." */
  notice?: string;
}

function upgradeButtons(a: AccountInfo, lead: string): Html {
  if (!a.billing) return html`<p class="muted">Paid Pro is coming soon.</p>`;
  return html`<p>${lead}</p>
    <div class="row" style="margin-top:14px">
      <form method="post" action="/billing/checkout"><input type="hidden" name="interval" value="month"><button class="btn btn-primary">Get Pro for ${PRO_PRICE_LABEL.month}</button></form>
      <form method="post" action="/billing/checkout"><input type="hidden" name="interval" value="year"><button class="btn btn-ghost">Or ${PRO_PRICE_LABEL.year} (save 20%)</button></form>
    </div>
    <p class="muted" style="font-size:.85rem;margin-top:10px">Prices include tax. Cancel any time.</p>`;
}

function planSection(a: AccountInfo): Html {
  const manage = a.canManage
    ? html`<form method="post" action="/billing/portal" style="margin-top:12px"><button>Manage subscription and invoices</button></form>`
    : "";
  if (a.paid) {
    return html`${a.upgraded ? html`<p class="warn">Welcome to Pro. Thanks for supporting Context!</p>` : ""}
      <p>You're on <strong>Pro</strong>. Undo anything on the <a href="/history">History</a> page, and your AI apps search your memories by meaning as well as by words.</p>
      ${a.bonusDays > 0
        ? html`<p class="muted">You also have ${a.bonusDays} free days from invites saved. They start if your paid plan ends.</p>`
        : ""}
      ${manage}`;
  }
  if (a.plan === "pro" && a.proUntil) {
    return html`<p>You have <strong>free Pro until ${formatDate(a.proUntil)}</strong>, thanks to invites.</p>
      ${upgradeButtons(a, "Want to keep Pro after that?")}
      ${manage}`;
  }
  const leftover =
    a.history > 0 && a.historyUntil
      ? html`<p class="warn">${a.history} old version${a.history === 1 ? " is" : "s are"} still kept from before. ${a.history === 1 ? "It" : "They"} will be deleted on ${formatDate(a.historyUntil)} unless you get Pro.</p>`
      : "";
  return html`${a.upgraded ? html`<p class="warn">Thanks! Your payment is being confirmed. Refresh this page in a few seconds.</p>` : ""}
    <p>You're on the <strong>free plan</strong>.</p>
    ${leftover}
    ${upgradeButtons(a, "Pro adds the undo button, search by meaning, weekly cleanup, Google Drive backups and API keys.")}
    <p class="muted" style="margin-top:12px">Or get Pro free: <a href="/invite">invite a friend</a>.</p>
    ${manage}`;
}

function proTools(a: AccountInfo): Html {
  return html`${a.cleanup.available ? cleanupSettings(a) : ""} ${a.backupsAvailable ? backupSection(a) : ""} ${apiKeySection(a)}`;
}

function cleanupSettings(a: AccountInfo): Html {
  const c = a.cleanup;
  return html`<h2>Automatic cleanup</h2>
    <p>Once a week, Context looks for memories that repeat each other or are out of date, and suggests fixes.
      ${c.lastRun ? html`Last checked ${formatDate(c.lastRun)}.` : "The first check runs within a day."}
      ${c.pending ? html`<a href="/cleanup">Review ${c.pending} suggestion${c.pending === 1 ? "" : "s"}</a>.` : html`<a href="/cleanup">See cleanup</a>.`}</p>
    <form method="post" action="/cleanup/auto" class="row" style="margin-top:10px">
      <label style="display:flex;gap:8px;align-items:center;font-weight:400">
        <input type="checkbox" name="auto" value="1" ${c.auto ? "checked" : ""} style="width:auto">
        Merge repeats without asking (you can undo them in History)
      </label>
      <button class="btn btn-ghost btn-small">Save</button>
    </form>`;
}

function backupSection(a: AccountInfo): Html {
  const b = a.backup;
  if (!b) {
    return html`<h2>Back up to Google Drive</h2>
      <p>Every day, a copy of your memories goes into a “Context Backups” folder in your Google Drive. Context can only see the files it makes there. The newest 30 backups are kept.</p>
      <p style="margin-top:12px"><a class="btn btn-ghost" href="/backup/google/connect">Connect Google Drive</a></p>`;
  }
  return html`<h2>Back up to Google Drive</h2>
    <p>Backing up to the “Context Backups” folder${b.account_email ? html` in <strong>${b.account_email}</strong>` : ""}.
      ${b.last_backup_at ? html`Last backup ${formatDateTime(b.last_backup_at)}.` : "The first backup hasn't run yet."}</p>
    ${b.last_error ? html`<p class="warn">${b.last_error}${b.needs_reconnect ? html` <a href="/backup/google/connect">Connect again</a>` : ""}</p>` : ""}
    <div class="row" style="margin-top:12px;align-items:center">
      <form method="post" action="/backup/frequency" class="row" style="align-items:center">
        <select name="frequency" aria-label="How often" style="width:auto">
          <option value="daily" ${b.frequency === "daily" ? "selected" : ""}>Every day</option>
          <option value="weekly" ${b.frequency === "weekly" ? "selected" : ""}>Every week</option>
        </select>
        <button class="btn btn-ghost btn-small">Save</button>
      </form>
      <form method="post" action="/backup/now"><button class="btn btn-ghost btn-small">Back up now</button></form>
      <form method="post" action="/backup/disconnect"><button class="btn-small">Disconnect</button></form>
    </div>
    <p class="muted" style="font-size:.85rem;margin-top:8px">Disconnecting stops backups. Files already in your Drive stay there.</p>`;
}

function apiKeySection(a: AccountInfo): Html {
  const created = a.newKey
    ? html`<div class="note stack" style="margin:12px 0">
        <p><strong>Copy your new key now.</strong> For your security, it won't be shown again.</p>
        <div class="copy-row"><code id="new-key">${a.newKey}</code><button class="btn btn-ghost btn-small" type="button" data-copy="new-key">Copy</button></div>
      </div>`
    : "";
  return html`<h2 id="api-keys">API keys</h2>
    <p>Use Context from scripts, or from AI tools that take a key instead of signing in (Claude Code, Cursor and others). A key can read and change all your memories, so keep it secret. <a href="/docs#api">How to use a key</a></p>
    ${created}
    ${a.keys.length
      ? html`<div class="stack" style="margin-top:12px">${a.keys.map(
          (k) => html`<div class="card" style="margin:0">
            <div><strong>${k.name}</strong> <code>${k.prefix}…</code></div>
            <div class="meta">
              <span>Created ${formatDate(k.created_at)}</span>
              <span>${k.last_used_at ? `Last used ${formatDate(k.last_used_at)}` : "Not used yet"}</span>
              <form class="inline" method="post" action="/account/keys/${k.id}/revoke"><button>Delete</button></form>
            </div>
          </div>`
        )}</div>`
      : ""}
    <form method="post" action="/account/keys" class="row" style="margin-top:12px;max-width:520px">
      <input name="name" placeholder="Name, e.g. Claude Code" maxlength="40" required aria-label="Key name" style="flex:1">
      <button class="btn btn-ghost">Create key</button>
    </form>
    <p class="muted" style="font-size:.85rem;margin-top:8px">Memories a key saves show its name as where they came from.</p>`;
}

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";

// --- Cleanup (Pro) ----------------------------------------------------------------

export function cleanupPage(
  items: SuggestionView[],
  opts: { pro: boolean; available: boolean; billing: boolean; lastRun: string | null; canRunNow: boolean; notice?: string }
): Html {
  if (!opts.pro || !opts.available) {
    return layout(
      "Cleanup",
      html`<div class="empty">
          ${Crab("sleeping")}
          <h1>${opts.available ? "Cleanup is part of Pro" : "Cleanup isn't set up here"}</h1>
          <p class="lead">${opts.available ? "Once a week, Context finds memories that repeat or are out of date, and suggests fixes." : "This server has no Workers AI binding."}</p>
          ${opts.available
            ? html`<div class="row">
                ${opts.billing ? html`<a class="btn btn-primary" href="/account">See Pro</a>` : ""}
                <a class="btn btn-ghost" href="/invite">Get it free with invites</a>
              </div>`
            : ""}
        </div>`,
      { signedIn: true }
    );
  }
  const memoryLine = (m: Memory) =>
    html`<li>${m.content} <span class="muted" style="font-size:.85rem">(${CATEGORY_LABELS[m.category]}, ${m.source})</span></li>`;
  const card = (s: SuggestionView) => html`<div class="card">
      <div class="meta" style="margin-top:0"><strong>${s.kind === "merge" ? "Combine" : "Forget"}</strong> <span>${s.reason}</span></div>
      <ul style="margin:8px 0">${s.memories.map(memoryLine)}</ul>
      ${s.kind === "merge" ? html`<div><span class="muted">Into:</span> ${s.content}</div>` : ""}
      <div class="meta">
        <form class="inline" method="post" action="/cleanup/${s.id}/apply"><button class="btn btn-primary btn-small">${s.kind === "merge" ? "Combine" : "Forget"}</button></form>
        <form class="inline" method="post" action="/cleanup/${s.id}/dismiss"><button>Keep as is</button></form>
      </div>
    </div>`;
  return layout(
    "Cleanup",
    html`<h1>Cleanup</h1>
      ${opts.notice ? html`<p class="note">${opts.notice}</p>` : ""}
      <p class="lead">Memories that repeat each other or look out of date. Anything you change here can be undone from <a href="/history">History</a>.</p>
      <p class="muted">${opts.lastRun ? html`Last checked ${formatDateTime(opts.lastRun)}.` : "Not checked yet."} Context checks once a week.</p>
      <div class="row" style="margin:14px 0">
        ${opts.canRunNow
          ? html`<form method="post" action="/cleanup/run"><button class="btn btn-ghost btn-small">Check now</button></form>`
          : html`<span class="muted" style="font-size:.9rem">You can check again in an hour.</span>`}
        ${items.some((s) => s.kind === "merge")
          ? html`<form method="post" action="/cleanup/apply-all"><button class="btn btn-ghost btn-small">Combine all repeats</button></form>`
          : ""}
      </div>
      ${items.length === 0
        ? html`<div class="empty">${Crab("curious")}<p class="lead">Nothing to tidy up right now.</p></div>`
        : items.map(card)}`,
    { signedIn: true }
  );
}

export function accountPage(a: AccountInfo, error?: string): Html {
  return layout(
    "Account",
    html`<h1>Account</h1>
      <p class="lead">Signed in as <strong>${a.email}</strong>, with ${a.active.toLocaleString("en")} memor${a.active === 1 ? "y" : "ies"}.</p>
      ${a.notice ? html`<p class="note">${a.notice}</p>` : ""}
      <h2>Plan</h2>
      ${planSection(a)}
      ${a.plan === "pro" ? proTools(a) : ""}
      <h2>Download</h2>
      <p class="muted"><a href="/export/memories.md" download>Download a copy</a> of every memory. (For other apps: <a href="/export/memories.json" download>data file</a>.)</p>
      <h2>Delete account</h2>
      <div class="danger-zone stack">
        <p class="muted">This deletes everything, stops any payments and disconnects your AI apps. It can't be undone.</p>
        ${error ? html`<p class="warn">${error}</p>` : ""}
        <form method="post" action="/account/delete" class="stack" style="max-width:420px">
          <label for="confirm">Type <strong>delete</strong> to confirm</label>
          <input id="confirm" name="confirm" autocomplete="off" required>
          <div><button class="btn btn-danger">Delete my account</button></div>
        </form>
      </div>`,
    { signedIn: true, current: "/account" }
  );
}

// --- History --------------------------------------------------------------------

export function historyPage(entries: HistoryEntry[], opts: { plan: Plan; billing: boolean; historyUntil: string | null }): Html {
  const pro = opts.plan === "pro";
  if (!pro && entries.length === 0) {
    return layout(
      "History",
      html`<div class="empty">
          ${Crab("sleeping")}
          <h1>History is part of Pro</h1>
          <p class="lead">Pro keeps old versions, so you can undo any change.</p>
          <div class="row">
            ${opts.billing ? html`<a class="btn btn-primary" href="/account">See Pro</a>` : ""}
            <a class="btn btn-ghost" href="/invite">Get it free with invites</a>
          </div>
        </div>`,
      { signedIn: true, current: "/history" }
    );
  }
  return layout(
    "History",
    html`<h1>History</h1>
      ${pro
        ? html`<p class="lead">Old versions and forgotten memories, newest first.</p>`
        : html`<p class="warn">These were kept from before${opts.historyUntil ? html` and will be deleted on ${formatDate(opts.historyUntil)}` : ""}. <a href="/account">Get Pro</a> to keep and restore them.</p>`}
      ${entries.length === 0
        ? html`<div class="empty">${Crab("curious")}<p class="lead">Nothing here yet. Old versions show up here when memories change.</p></div>`
        : ""}
      ${entries.map(historyCard(pro))}`,
    { signedIn: true, current: "/history" }
  );
}

const who = (editor: string | null) => (!editor ? "" : editor === "You" ? " by you" : ` by ${editor}`);

// The old version is labelled "Before" and what it became "After". When an edit kept the
// same text, say what did change, so the two don't look identical.
function historyCard(pro: boolean) {
  return (e: HistoryEntry): Html => {
    let heading: string;
    let after: Html | string = "";
    if (e.status === "forgotten") {
      heading = `Forgotten ${formatDate(e.updated_at)}`;
    } else {
      const merged = e.next_sources > 1;
      heading = `${merged ? "Joined" : "Changed"} ${formatDate(e.updated_at)}${who(e.next_edited_by)}`;
      if (e.next_content !== null) {
        const notes = [
          e.next_category && e.next_category !== e.category
            ? `category changed from ${CATEGORY_LABELS[e.category]} to ${CATEGORY_LABELS[e.next_category]}`
            : "",
          e.next_explicit !== null && e.next_explicit !== e.explicit
            ? e.next_explicit ? "marked as something you said" : "marked as an AI guess"
            : ""
        ].filter(Boolean);
        const sameText = e.next_content === e.content;
        after = html`<div class="meta"><strong>${merged ? "Joined into" : "After"}:</strong>&nbsp;${sameText
          ? html`<span>same text${notes.length ? `; ${notes.join("; ")}` : ""}</span>`
          : html`<span style="color:var(--ink)">${e.next_content}</span>${notes.length ? html`<span>(${notes.join("; ")})</span>` : ""}`}</div>`;
      }
    }
    return html`<div class="card">
      <div class="meta" style="margin-top:0">${heading}</div>
      <div><span class="muted">${e.status === "forgotten" ? "Memory" : "Before"}:</span> ${e.content}</div>
      ${after}
      <div class="meta">
        <span>${CATEGORY_LABELS[e.category]}</span>
        <span>Saved by ${e.source}</span>
        ${pro ? html`<form class="inline" method="post" action="/history/${e.id}/restore"><button>Restore${e.status === "forgotten" ? "" : " this version"}</button></form>` : ""}
      </div>
    </div>`;
  };
}

export function accountDeletedPage(): Html {
  return layout(
    "Account deleted",
    html`<div class="empty">${Crab("waving")}
      <h1>Your account has been deleted</h1>
      <p class="lead">Your memories are gone and your AI apps are disconnected.</p>
      <a class="btn btn-ghost" href="/">Back to Context</a></div>`
  );
}

// --- Stats (ADMIN_EMAILS only) ----------------------------------------------------

export function statsPage(rows: SourceStats[]): Html {
  const sum = (k: Exclude<keyof SourceStats, "source">) => rows.reduce((n, r) => n + (r[k] ?? 0), 0);
  const t = {
    signups: sum("signups"), last7: sum("last7"), last30: sum("last30"), connected: sum("connected"), saved: sum("saved"),
    twoApps: sum("twoApps"), active: sum("active"), active2: sum("active2"), paid: sum("paid"), invitePro: sum("invitePro"), grantedPro: sum("grantedPro")
  };
  const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "–");
  const steps: [string, number][] = [
    ["Signed up", t.signups],
    ["Connected an AI app", t.connected],
    ["An AI saved a memory", t.saved],
    ["Connected a second AI app", t.twoApps]
  ];
  return layout(
    "Stats",
    html`<style>
        .stats-table { width: 100%; border-collapse: collapse; margin: 10px 0 28px; font-size: .95rem; }
        .stats-table th, .stats-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); }
        .stats-table th { color: var(--faint); font-weight: 600; font-size: .84rem; }
        .stats-table .n { text-align: right; font-variant-numeric: tabular-nums; }
        .table-scroll { overflow-x: auto; }
      </style>
      <h1>Stats</h1>
      <div class="stats">
        <div><b>${t.signups}</b><span>signups</span></div>
        <div><b>${t.last7}</b><span>last 7 days</span></div>
        <div><b>${t.last30}</b><span>last 30 days</span></div>
        <div><b>${t.active2}</b><span>active with 2+ apps this week</span></div>
      </div>

      <h2>Funnel</h2>
      <div class="table-scroll"><table class="stats-table">
        <tr><th>Step</th><th class="n">Users</th><th class="n">Of signups</th><th class="n">Of previous step</th></tr>
        ${steps.map(([label, n], i) => html`<tr><td>${label}</td><td class="n">${n}</td><td class="n">${pct(n, t.signups)}</td><td class="n">${i ? pct(n, steps[i - 1][1]) : ""}</td></tr>`)}
      </table></div>

      <h2>This week</h2>
      <div class="table-scroll"><table class="stats-table">
        <tr><th>Active users</th><th class="n">Users</th><th class="n">Of signups</th></tr>
        <tr><td>Used any AI app</td><td class="n">${t.active}</td><td class="n">${pct(t.active, t.signups)}</td></tr>
        <tr><td>Used 2+ AI apps</td><td class="n">${t.active2}</td><td class="n">${pct(t.active2, t.signups)}</td></tr>
      </table></div>

      <h2>Pro</h2>
      <div class="table-scroll"><table class="stats-table">
        <tr><th>Pro now</th><th class="n">Users</th></tr>
        <tr><td>Paying</td><td class="n">${t.paid}</td></tr>
        <tr><td>Free from invites</td><td class="n">${t.invitePro}</td></tr>
        <tr><td>Granted by hand</td><td class="n">${t.grantedPro}</td></tr>
      </table></div>

      <h2>By source</h2>
      <div class="table-scroll"><table class="stats-table">
        <tr><th>Source</th><th class="n">Signups</th><th class="n">Last 30 days</th><th class="n">Connected</th><th class="n">2+ apps</th><th class="n">2+ apps %</th></tr>
        ${rows.map((r) => html`<tr><td>${r.source}</td><td class="n">${r.signups}</td><td class="n">${r.last30}</td><td class="n">${r.connected}</td><td class="n">${r.twoApps}</td><td class="n">${pct(r.twoApps, r.signups)}</td></tr>`)}
      </table></div>

      <h2>How these are counted</h2>
      <ul class="muted" style="font-size:.9rem">
        <li><b>Source</b> is the first <code>utm_source</code>, <code>ref</code> or <code>via</code> link tag, or else the referring site, seen before sign-up. "invite" means an invite link, "direct" means neither, "unknown" means the account predates tracking.</li>
        <li><b>Connected</b> means approving an AI app on the consent page, or that app using Context. Apps are counted by name (ChatGPT, Claude, Gemini, Grok, ...), so reconnecting the same app doesn't count twice.</li>
        <li><b>An AI saved a memory</b> means an AI app called remember. Imports and edits on this site don't count.</li>
        <li><b>Active</b> means an AI app read or wrote this person's memories (any tool call) in the last 7 days, recorded at most once an hour per app.</li>
        <li>For accounts from before tracking, connections and AI saves are estimated from memories saved by an app (leaving out batches too big to be anything but imports), and their activity counts only those saves and edits.</li>
      </ul>`,
    { signedIn: true }
  );
}
