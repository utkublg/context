// Context test bench: does Claude use Context when it should, and leave it alone when it shouldn't?
//
//   npm run bench                         full matrix (every scenario x variant, 3 repeats)
//   npm run bench -- --variants auto,auto+prefs --scenarios dinner,regex --repeats 5
//   npm run bench -- --model claude-haiku-5-5   cheap model for quick iteration
//   npm run bench -- --dry                print what would run, without calling the API
//   npm run bench -- --snapshot v2        save the current tool definitions as bench/snapshots/v2.json
//
// Each trial runs the real MCP server from src/mcp.ts in-process against a fresh in-memory
// database seeded with a fictional user. Nothing touches production.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { buildMcpServer } from "../src/mcp";
import { insertMemories, listActive } from "../src/memories";
import { check, isCategoryFailure, isJunkFailure, isSaveFailure, isUpdateFailure, READ_TOOLS, WRITE_TOOLS, type MemoryRow, type TurnResult } from "./checks";
import { addUsage, apiKey, cost, createMessage, type Usage } from "./claude";
import { createTestDb } from "./d1";
import { SCENARIOS, SEED_MEMORIES, type Expect, type Scenario } from "./scenarios";
import { DECOY_RESULT, DECOY_TOOLS, VARIANTS, systemPrompt, type Variant } from "./variants";

const MAX_STEPS_PER_TURN = 8;
const USER_ID = "bench-user";

// ---------- args ----------

const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const list = (name: string) => arg(name)?.split(",").map((s) => s.trim());
const opts = {
  model: arg("model") ?? "claude-sonnet-5-5",
  repeats: Number(arg("repeats") ?? 3),
  concurrency: Number(arg("concurrency") ?? 4),
  variants: list("variants"),
  scenarios: list("scenarios"),
  dry: argv.includes("--dry"),
  snapshot: arg("snapshot")
};

// ---------- the Context server, in-process ----------

interface ToolDefs {
  instructions: string;
  tools: { name: string; description?: string; inputSchema: Record<string, unknown> }[];
}

async function startContext() {
  const db = createTestDb();
  // Pro, so an update leaves the old row superseded under its own id, which the "retired" checks look for.
  await db.prepare("INSERT INTO users (id, google_sub, email, plan) VALUES (?, 'bench', 'sam@example.com', 'pro')").bind(USER_ID).run();
  await insertMemories(db, USER_ID, SEED_MEMORIES, "ChatGPT");
  const server = buildMcpServer({ DB: db } as any, { userId: USER_ID, clientName: "Claude" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "context-bench", version: "0.1.0" });
  await server.connect(serverSide);
  await client.connect(clientSide);
  return { db, client };
}

async function currentDefs(): Promise<ToolDefs> {
  const { client } = await startContext();
  const { tools } = await client.listTools();
  return {
    instructions: client.getInstructions() ?? "",
    tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as Record<string, unknown> }))
  };
}

async function loadDefs(name: string): Promise<ToolDefs> {
  if (name === "current") return currentDefs();
  return JSON.parse(readFileSync(`bench/snapshots/${name}.json`, "utf8"));
}

// ---------- one trial: a whole scenario conversation under one variant ----------

interface Trial {
  scenario: string;
  variant: string;
  repeat: number;
  turns: TurnResult[];
  usage: Usage;
  error?: string;
  messages: unknown[];
}

function apiTools(defs: ToolDefs, v: Variant) {
  const defer = v.loading === "deferred" ? { defer_loading: true } : {};
  const context = defs.tools.map(({ name, description, inputSchema }) => {
    const { $schema, ...schema } = inputSchema;
    return { name, description, input_schema: schema, ...defer };
  });
  const tools: object[] = [...context, ...DECOY_TOOLS.map((t) => ({ ...t, ...defer }))];
  // We don't know which search variant the Claude app uses; BM25 takes natural-language queries.
  if (v.loading === "deferred") tools.unshift({ type: "tool_search_tool_bm25_20251119", name: "tool_search_tool_bm25" });
  return tools;
}

// Cache the growing conversation so each step of a trial only pays full price for new tokens.
function withCacheBreakpoint(messages: any[]) {
  const out = messages.slice();
  const last = { ...out[out.length - 1] };
  const content = typeof last.content === "string" ? [{ type: "text", text: last.content }] : last.content.slice();
  content[content.length - 1] = { ...content[content.length - 1], cache_control: { type: "ephemeral" } };
  last.content = content;
  out[out.length - 1] = last;
  return out;
}

async function runTrial(key: string, scenario: Scenario, v: Variant, defs: ToolDefs, repeat: number): Promise<Trial> {
  const { db, client } = await startContext();
  const tools = apiTools(defs, v);
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const system = [{ type: "text", text: systemPrompt(v, defs.instructions, today), cache_control: { type: "ephemeral" } }];
  const messages: any[] = [];
  const trial: Trial = { scenario: scenario.id, variant: v.id, repeat, turns: [], usage: { input_tokens: 0, output_tokens: 0 }, messages };

  const active = async (): Promise<MemoryRow[]> =>
    (await listActive(db, USER_ID)).map(({ id, content, category }) => ({ id, content, category }));

  try {
    for (const turn of scenario.turns) {
      const before = await active();
      const result: TurnResult = { calls: [], toolSearches: [], text: "", saved: [], retired: [], failures: [] };
      messages.push({ role: "user", content: turn.user });

      for (let step = 0; step < MAX_STEPS_PER_TURN; step++) {
        const res = await createMessage(key, { model: opts.model, max_tokens: 2048, system, tools, messages: withCacheBreakpoint(messages) });
        trial.usage = addUsage(trial.usage, res.usage);
        messages.push({ role: "assistant", content: res.content });

        const results: object[] = [];
        for (const block of res.content) {
          if (block.type === "text") result.text += block.text + "\n";
          if (block.type === "server_tool_use") result.toolSearches.push(block.input);
          if (block.type !== "tool_use") continue;
          result.calls.push({ name: block.name, input: block.input });
          let output = DECOY_RESULT;
          let isError = false;
          if (defs.tools.some((t) => t.name === block.name)) {
            const r: any = await client.callTool({ name: block.name, arguments: block.input });
            output = r.content.map((c: any) => c.text ?? "").join("\n");
            isError = !!r.isError;
          }
          results.push({ type: "tool_result", tool_use_id: block.id, content: output, ...(isError ? { is_error: true } : {}) });
        }

        if (res.stop_reason === "pause_turn") continue; // server-side tool search still running
        if (results.length === 0) break;
        messages.push({ role: "user", content: results });
      }

      const after = await active();
      const beforeIds = new Set(before.map((m) => m.id));
      const afterIds = new Set(after.map((m) => m.id));
      result.saved = after.filter((m) => !beforeIds.has(m.id)).map(({ content, category }) => ({ content, category }));
      result.retired = before.filter((m) => !afterIds.has(m.id)).map((m) => m.content);
      result.failures = check(turn.expect, result, before, after);
      trial.turns.push(result);
    }
  } catch (e) {
    trial.error = String(e);
  }
  return trial;
}

// ---------- report ----------

const pct = (a: number, b: number) => (b === 0 ? "–" : `${Math.round((100 * a) / b)}%`);

function report(trials: Trial[], variants: Variant[], scenarios: Scenario[]): string {
  const ok = trials.filter((t) => !t.error);
  const lines: string[] = [];
  lines.push(`# Context bench: ${opts.model}, ${opts.repeats} repeats, ${new Date().toISOString().slice(0, 16)}`);
  lines.push("");
  lines.push("Each cell: trials where every check passed for that turn.");
  lines.push("");
  lines.push(`| scenario | ${variants.map((v) => v.id).join(" | ")} |`);
  lines.push(`|---|${variants.map(() => "---").join("|")}|`);
  for (const s of scenarios) {
    s.turns.forEach((_, ti) => {
      const label = s.turns.length > 1 ? `${s.id} #${ti + 1}` : s.id;
      const cells = variants.map((v) => {
        const ts = ok.filter((t) => t.scenario === s.id && t.variant === v.id);
        return `${ts.filter((t) => t.turns[ti]?.failures.length === 0).length}/${ts.length}`;
      });
      lines.push(`| ${s.kind}: ${label} | ${cells.join(" | ")} |`);
    });
  }

  // Rates per variant, so one change's effect is readable at a glance.
  const rate = (v: Variant, pick: (e: Expect) => boolean, pass: (t: TurnResult, e: Expect) => boolean) => {
    let n = 0, p = 0;
    for (const t of ok.filter((t) => t.variant === v.id)) {
      const s = scenarios.find((s) => s.id === t.scenario)!;
      s.turns.forEach((turn, i) => {
        if (!pick(turn.expect) || !t.turns[i]) return;
        n++;
        if (pass(t.turns[i], turn.expect)) p++;
      });
    }
    return pct(p, n);
  };
  const read = (t: TurnResult) => t.calls.some((c) => READ_TOOLS.has(c.name));
  const rows: [string, (v: Variant) => string][] = [
    ["reads when needed", (v) => rate(v, (e) => e.read === true, (t) => read(t))],
    ["leaves it alone when not", (v) => rate(v, (e) => e.read === false, (t) => !read(t))],
    ["answer uses Context facts", (v) => rate(v, (e) => !!(e.answer || e.answerNot), (t) => !t.failures.some((f) => f.startsWith("answer")))],
    ["saves without being asked", (v) => rate(v, (e) => !!e.write, (t) => !t.failures.some(isSaveFailure))],
    ["updates instead of duplicating", (v) => rate(v, (e) => !!(e.retired || e.unique), (t) => !t.failures.some(isUpdateFailure))],
    ["doesn't save junk", (v) => rate(v, (e) => !!e.noWrite, (t) => !t.failures.some(isJunkFailure))],
    ["files in the right category", (v) => rate(v, (e) => !!e.savedCategory, (t) => !t.failures.some(isCategoryFailure))],
    ["all checks", (v) => rate(v, () => true, (t) => t.failures.length === 0)],
    ["update_memory share of writes", (v) => {
      const writes = ok.filter((t) => t.variant === v.id).flatMap((t) => t.turns.flatMap((r) => r.calls)).filter((c) => WRITE_TOOLS.has(c.name));
      return pct(writes.filter((c) => c.name === "update_memory").length, writes.length);
    }],
    ["tool searches per turn", (v) => {
      const ts = ok.filter((t) => t.variant === v.id).flatMap((t) => t.turns);
      return ts.length ? (ts.reduce((a, t) => a + t.toolSearches.length, 0) / ts.length).toFixed(1) : "–";
    }]
  ];
  lines.push("");
  lines.push(`| summary | ${variants.map((v) => v.id).join(" | ")} |`);
  lines.push(`|---|${variants.map(() => "---").join("|")}|`);
  for (const [name, f] of rows) lines.push(`| ${name} | ${variants.map(f).join(" | ")} |`);

  const failures = ok.flatMap((t) =>
    t.turns.flatMap((r, i) => (r.failures.length ? [`- ${t.variant} / ${t.scenario}${t.turns.length > 1 ? ` #${i + 1}` : ""} (run ${t.repeat + 1}): ${r.failures.join("; ")}`] : []))
  );
  if (failures.length) lines.push("", "## Failures", "", ...failures);
  const errors = trials.filter((t) => t.error);
  if (errors.length) lines.push("", "## Errors", "", ...errors.map((t) => `- ${t.variant} / ${t.scenario}: ${t.error}`));

  const usage = trials.reduce((a, t) => addUsage(a, t.usage), { input_tokens: 0, output_tokens: 0 } as Usage);
  const usd = cost(opts.model, usage);
  lines.push(
    "",
    `Tokens: ${usage.input_tokens} input, ${usage.cache_creation_input_tokens} cache write, ${usage.cache_read_input_tokens} cache read, ${usage.output_tokens} output.` +
      (usd === null ? "" : ` Estimated cost: $${usd.toFixed(2)}.`)
  );
  return lines.join("\n");
}

// ---------- main ----------

async function main() {
  if (opts.snapshot) {
    mkdirSync("bench/snapshots", { recursive: true });
    writeFileSync(`bench/snapshots/${opts.snapshot}.json`, JSON.stringify(await currentDefs(), null, 2) + "\n");
    console.log(`Saved bench/snapshots/${opts.snapshot}.json`);
    return;
  }

  const variants = opts.variants ? VARIANTS.filter((v) => opts.variants!.includes(v.id)) : VARIANTS;
  const scenarios = opts.scenarios ? SCENARIOS.filter((s) => opts.scenarios!.includes(s.id)) : SCENARIOS;
  if (!variants.length || !scenarios.length) throw new Error(`Nothing to run. Variants: ${VARIANTS.map((v) => v.id)}. Scenarios: ${SCENARIOS.map((s) => s.id)}.`);

  const jobs = variants.flatMap((v) => scenarios.flatMap((s) => Array.from({ length: opts.repeats }, (_, r) => ({ v, s, r }))));
  console.log(`${jobs.length} trials: ${scenarios.length} scenarios x ${variants.length} variants x ${opts.repeats} repeats, model ${opts.model}`);
  if (opts.dry) return;

  const key = apiKey();
  const defs = new Map<string, ToolDefs>();
  for (const v of variants) if (!defs.has(v.tools)) defs.set(v.tools, await loadDefs(v.tools));

  const trials: Trial[] = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const { v, s, r } = jobs[next++];
      const t = await runTrial(key, s, v, defs.get(v.tools)!, r);
      trials.push(t);
      const status = t.error ? "error" : t.turns.every((x) => x.failures.length === 0) ? "pass" : "fail";
      process.stderr.write(`[${trials.length}/${jobs.length}] ${v.id} / ${s.id}: ${status}\n`);
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency }, worker));

  const order = (t: Trial) => jobs.findIndex((j) => j.v.id === t.variant && j.s.id === t.scenario && j.r === t.repeat);
  trials.sort((a, b) => order(a) - order(b));
  const md = report(trials, variants, scenarios);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  mkdirSync("bench/results", { recursive: true });
  writeFileSync(`bench/results/${stamp}.md`, md + "\n");
  writeFileSync(`bench/results/${stamp}.json`, JSON.stringify({ opts, trials }, null, 2));
  console.log("\n" + md + `\n\nSaved bench/results/${stamp}.md (full transcripts in .json)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
