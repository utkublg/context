// Per-account request limit for the MCP endpoint and the REST API, using Cloudflare's rate
// limiting binding (RATE_LIMIT in wrangler.jsonc). Counted per account, not per key or app, so
// extra API keys don't raise it. Normal use is a few requests a minute; the limit is there to stop
// a runaway script from running up Workers AI costs (each Pro search embeds the query).
import type { Env } from "./env";

/** True if this account may make another request now. Always true without the binding. */
export async function withinLimit(env: Pick<Env, "RATE_LIMIT">, userId: string): Promise<boolean> {
  if (!env.RATE_LIMIT) return true;
  try {
    return (await env.RATE_LIMIT.limit({ key: userId })).success;
  } catch (e) {
    // Never lock people out because the limiter itself failed.
    console.error("rate limiter failed", e);
    return true;
  }
}

export const tooManyRequests = () =>
  Response.json(
    { error: "rate_limited", message: "Too many requests. Wait a minute and try again." },
    { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } }
  );
