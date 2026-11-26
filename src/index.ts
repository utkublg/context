import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import type { Env, AuthProps } from "./env";
import { buildMcpServer, sourceLabel } from "./mcp";
import web from "./web";
import { purgeExpiredHistory } from "./memories";
import { recordUse } from "./funnel";
import { resolveApiKey } from "./apikeys";
import { pruneVectors } from "./semantic";
import { runCleanups } from "./cleanup";
import { runBackups } from "./backup";
import { tooManyRequests, withinLimit } from "./ratelimit";

// Reached only with a valid access token; OAuthProvider puts the grant's props on ctx.props.
// A fresh MCP server per request keeps the Worker stateless: no Durable Objects to pay for.
const mcpApi = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const props = (ctx as ExecutionContext & { props: AuthProps }).props;
    if (!(await withinLimit(env, props.userId))) return tooManyRequests();
    // Every tool reads or writes memories, so a tool call is what counts as using an app (/stats).
    if (request.method === "POST" && (await request.clone().text()).includes('"tools/call"')) {
      ctx.waitUntil(recordUse(env.DB, props.userId, sourceLabel(props.clientName)));
    }
    return createMcpHandler(() => buildMcpServer(env, props), {
      route: "/mcp",
      allowedHostnames: [new URL(env.PUBLIC_URL).hostname]
    })(request, env, ctx);
  }
};

// Must match "triggers" in wrangler.jsonc.
const CRON = { daily: "17 3 * * *", backups: "7 * * * *", cleanup: "37 * * * *" };

// The provider needs the public URL at construction, which only exists on env, so build it on
// first request and reuse it for the life of the isolate.
let provider: OAuthProvider<Env> | undefined;

function getProvider(env: Env): OAuthProvider<Env> {
  const base = env.PUBLIC_URL.replace(/\/$/, "");
  provider ??= new OAuthProvider<Env>({
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
    // Every refresh writes the grant and a new token to KV, and the free plan allows 1,000 KV
    // writes a day. A day-long access token means one refresh per connected app per day instead
    // of one an hour. Deleting the account still revokes every grant, and its tokens, at once.
    accessTokenTTL: 24 * 60 * 60,
    // The default is a fixed 30 days, after which people would have to reconnect each app. With
    // an idle lifetime, a connection lasts as long as it's used at least once every 90 days.
    refreshTokenTTL: 90 * 24 * 60 * 60,
    refreshTokenIdleTTL: 90 * 24 * 60 * 60,
    // Personal API keys (Pro) also work here, for MCP clients that take a header instead of
    // OAuth, e.g. Claude Code: claude mcp add --transport http context <url> --header "Authorization: Bearer ctx_...".
    resolveExternalToken: async ({ token, env }) => {
      const key = await resolveApiKey(env.DB, token);
      if (!key || key === "not-pro") return null;
      return {
        props: { userId: key.userId, clientName: key.name, apiKeyId: key.keyId } satisfies AuthProps,
        audience: `${base}/mcp`
      };
    },
    resourceMetadata: {
      resource: `${base}/mcp`,
      authorization_servers: [base],
      scopes_supported: ["memory"],
      resource_name: "Context"
    }
  });
  return provider;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return getProvider(env).fetch(request, env, ctx);
  },
  // See triggers in wrangler.jsonc. Each job runs on its own schedule, so each gets its own
  // invocation limits (subrequests, time).
  async scheduled(controller: ScheduledController, env: Env) {
    switch (controller.cron) {
      case CRON.daily:
        // Free accounts' history once its grace period ends, then vectors nothing needs any more.
        await purgeExpiredHistory(env.DB);
        await pruneVectors(env);
        break;
      case CRON.backups:
        await runBackups(env);
        break;
      case CRON.cleanup:
        await runCleanups(env);
        break;
    }
  }
} satisfies ExportedHandler<Env>;
