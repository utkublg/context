import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  DB: D1Database;
  OAUTH_KV: KVNamespace;
  /** Workers AI: embeddings for semantic search and the model behind automatic cleanup (Pro).
   *  Optional, so a self-hosted copy without it falls back to keyword search and no cleanup. */
  AI?: Ai;
  /** Vectorize index of memory embeddings (Pro semantic search). Optional, like AI. */
  VECTORS?: VectorizeIndex;
  /** Per-account request limit for /mcp and /api/v1 (see ratelimits in wrangler.jsonc). Optional:
   *  without it, requests aren't rate limited. */
  RATE_LIMIT?: RateLimit;
  /** Injected by OAuthProvider into the default handler. */
  OAUTH_PROVIDER: OAuthHelpers;

  // vars (wrangler.jsonc)
  PUBLIC_URL: string;
  /** "true" lets any Google account sign up; otherwise only ALLOWED_EMAILS can sign in. */
  OPEN_SIGNUP: string;
  /** The legal entity named in the privacy policy, terms and footer. */
  COMPANY_NAME: string;
  /** Public contact for support, privacy requests and security reports. */
  SUPPORT_EMAIL: string;
  /** Stripe price ids for Pro (not secret). Billing is off until these and STRIPE_SECRET_KEY are set. */
  STRIPE_PRICE_MONTHLY?: string;
  STRIPE_PRICE_YEARLY?: string;
  /** Comma-separated Google account emails that can open /stats. Everyone else gets a 404. */
  ADMIN_EMAILS?: string;
  /** Public repository of this code, linked from the footer and /version. */
  SOURCE_URL?: string;
  /** The deployed commit, set by scripts/deploy.sh (`--var`). Shown at /version. */
  GIT_COMMIT?: string;
  /** Domain-verification token from OpenAI's plugin dashboard, served at /.well-known/openai-apps-challenge. */
  OPENAI_APPS_CHALLENGE?: string;
  /** Domain-verification token from Google Connected Console, served at /.well-known/google-connected-apps. */
  GOOGLE_CONNECTED_APPS_CHALLENGE?: string;
  /** Public key line for the official MCP Registry, served at /.well-known/mcp-registry-auth. */
  MCP_REGISTRY_AUTH?: string;

  // secrets (.dev.vars locally, `wrangler secret put` in production)
  /** Comma-separated Google account emails allowed to sign in when OPEN_SIGNUP isn't "true". */
  ALLOWED_EMAILS?: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  STRIPE_SECRET_KEY?: string;
  /** Signing secret of the webhook endpoint for /stripe/webhook. */
  STRIPE_WEBHOOK_SECRET?: string;
  /** Encrypts stored Google Drive refresh tokens (32+ random characters). Unset = backups off. */
  TOKEN_ENCRYPTION_KEY?: string;
  /** TEMPORARY: "email:sha256hex,..." accounts for /review-login (src/review-login.ts). Unset = off. */
  REVIEW_LOGINS?: string;
}

/** Stored in each OAuth grant and handed to the MCP handler on every request. */
export interface AuthProps extends Record<string, unknown> {
  userId: string;
  clientName: string;
  /** Set when the request came with a personal API key instead of an OAuth token. */
  apiKeyId?: string;
}
