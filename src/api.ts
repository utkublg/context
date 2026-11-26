// REST API for personal API keys (Pro), mounted at /api/v1. Meant for scripts and server-side
// automations: it sends no CORS headers, so other websites can't call it from a browser.
//
//   Authorization: Bearer ctx_...
//   GET    /api/v1/memories                 every active memory (?category=)
//   GET    /api/v1/search?q=...&limit=10    search, by meaning as well as words
//   POST   /api/v1/memories                 save: {"memories": [{"content", "category", "said_by_user"}]}
//   PATCH  /api/v1/memories/:id             change: {"content"?, "category"?, "said_by_user"?}
//   DELETE /api/v1/memories/:id             forget
//   POST   /api/v1/memories/merge           combine: {"ids": [...], "content", "category"?}
//
// Shares a limit of 120 requests a minute per account with /mcp (429 with Retry-After beyond it).
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "./env";
import { resolveApiKey } from "./apikeys";
import { memoryJson } from "./export";
import {
  CATEGORIES,
  forgetMemory,
  getActive,
  insertMemories,
  limitMessage,
  listActive,
  mergeMemories,
  updateMemory,
  writeAllowance
} from "./memories";
import { hybridSearch } from "./semantic";
import { tooManyRequests, withinLimit } from "./ratelimit";

type Vars = { userId: string; keyName: string };
const api = new Hono<{ Bindings: Env; Variables: Vars }>();

const fail = (status: 400 | 401 | 402 | 403 | 404, error: string, message: string) =>
  Response.json({ error, message }, { status, headers: { "Cache-Control": "no-store" } });

api.use("*", async (c, next) => {
  const token = c.req.header("Authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? "";
  const key = await resolveApiKey(c.env.DB, token);
  if (key === "not-pro") return fail(402, "pro_required", "API keys need Context Pro. Renew it on the Account page.");
  if (!key) return fail(401, "invalid_key", "Send a Context API key as 'Authorization: Bearer ctx_...'. Create one on the Account page.");
  if (!(await withinLimit(c.env, key.userId))) return tooManyRequests();
  c.set("userId", key.userId);
  c.set("keyName", key.name);
  await next();
  c.header("Cache-Control", "no-store");
});

const category = z.enum(CATEGORIES);
const content = z.string().trim().min(3).max(500);

async function body<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T> | Response> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return fail(400, "invalid_json", "The request body must be JSON.");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return fail(400, "invalid_request", parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return parsed.data;
}

api.get("/memories", async (c) => {
  const cat = c.req.query("category");
  if (cat && !CATEGORIES.includes(cat as any)) return fail(400, "invalid_request", `category must be one of ${CATEGORIES.join(", ")}`);
  const memories = await listActive(c.env.DB, c.get("userId"), cat as any);
  return c.json({ count: memories.length, memories: memories.map(memoryJson) });
});

api.get("/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 500);
  if (!q) return fail(400, "invalid_request", "Add a query: /api/v1/search?q=...");
  const limit = Math.min(50, Math.max(1, Number(c.req.query("limit")) || 10));
  const userId = c.get("userId");
  const hits = await hybridSearch(c.env, userId, await listActive(c.env.DB, userId), q, limit);
  return c.json({ count: hits.length, memories: hits.map(memoryJson) });
});

const newMemory = z.object({ content, category, said_by_user: z.boolean().default(true) });

api.post("/memories", async (c) => {
  const b = await body(c.req.raw, z.object({ memories: z.array(newMemory).min(1).max(100) }));
  if (b instanceof Response) return b;
  const userId = c.get("userId");
  const allowance = await writeAllowance(c.env.DB, userId);
  if (allowance.left < b.memories.length) return fail(403, "limit_reached", limitMessage(allowance.plan));
  const saved = await insertMemories(
    c.env.DB,
    userId,
    b.memories.map((m) => ({ content: m.content, category: m.category, explicit: m.said_by_user })),
    c.get("keyName")
  );
  return c.json({ count: saved.length, memories: saved.map(memoryJson) }, 201);
});

api.post("/memories/merge", async (c) => {
  const b = await body(c.req.raw, z.object({ ids: z.array(z.string()).min(2).max(20), content, category: category.optional() }));
  if (b instanceof Response) return b;
  const userId = c.get("userId");
  if ((await writeAllowance(c.env.DB, userId, { addsActive: false })).left < 1) return fail(403, "limit_reached", limitMessage("pro"));
  const result = await mergeMemories(c.env.DB, userId, b.ids, { content: b.content, category: b.category }, c.get("keyName"));
  if (!result) return fail(404, "not_found", "One or more ids aren't active memories.");
  return c.json({ memory: memoryJson(result.memory), replaced: result.replaced.map((m) => m.id) });
});

api.patch("/memories/:id", async (c) => {
  const b = await body(c.req.raw, z.object({ content: content.optional(), category: category.optional(), said_by_user: z.boolean().optional() }));
  if (b instanceof Response) return b;
  const userId = c.get("userId");
  if ((await writeAllowance(c.env.DB, userId, { addsActive: false })).left < 1) return fail(403, "limit_reached", limitMessage("pro"));
  const updated = await updateMemory(
    c.env.DB,
    userId,
    c.req.param("id"),
    { content: b.content, category: b.category, explicit: b.said_by_user },
    c.get("keyName")
  );
  return updated ? c.json({ memory: memoryJson(updated) }) : fail(404, "not_found", "No active memory with that id.");
});

api.delete("/memories/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  if (!(await getActive(c.env.DB, userId, id)) || !(await forgetMemory(c.env.DB, userId, id))) {
    return fail(404, "not_found", "No active memory with that id.");
  }
  return c.body(null, 204);
});

api.notFound(() => fail(404, "not_found", "Unknown endpoint. See https://keepyourcontext.com/docs#api"));

export default api;
