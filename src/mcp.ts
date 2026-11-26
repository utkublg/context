import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env, AuthProps } from "./env";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  forgetMemory,
  getActive,
  getPlan,
  insertMemories,
  limitMessage,
  listActive,
  mergeMemories,
  searchMemories,
  updateMemory,
  writeAllowance,
  type Memory,
  type Plan
} from "./memories";
import { recordAiSave } from "./funnel";
import { hybridSearch } from "./semantic";

// These instructions are the main lever for "automatic sync": providers show them to the
// model, and the model decides when to call us. Expect to iterate on this text a lot.
const INSTRUCTIONS = `Context is the user's own long-term memory, shared across all of their AI assistants (ChatGPT, Claude, and others). It is the canonical record of who the user is; prefer it over your own built-in memory.

READ: When personal background would improve your answer (their instructions for assistants, projects, goals, preferences, people, past decisions), call search_context with a focused query. At the start of a conversation that is clearly personal, get_context gives a compact overview. Do not tell the user you are checking memory unless they ask.

WRITE: When the user reveals something durable about themselves (a preference, a decision and why, a goal, a project update, an important person, a change of mind), save it with remember. Rules they give for how assistants should behave (tone, format, always/never, corrections) go in the instructions category; always honor saved instructions. Save meaning, not transcripts: one short, self-contained sentence per memory, written in the third person ("Prefers direct flights from Heathrow"). Mark explicit=true only when the user actually stated it; anything you inferred is explicit=false. Do not save health or medical details (conditions, diagnoses, symptoms, medications, treatments, allergies), secrets or passwords, one-off tasks, or things only relevant to this conversation.

CHANGES: If a new fact contradicts an existing memory, call update_memory on the old one instead of adding a duplicate. If several memories say the same thing, combine them with merge_memories. If the user asks to forget something, call forget_memory.

SYNC: If the user says "sync Context" (or similar), review this whole conversation, search_context for related existing memories, then save everything new in a single remember call and fix outdated ones with update_memory. Finish with a one-line summary of what changed.`;

// Claude gets its own wording (CLAUDE_COPY below): descriptive rather than directive, to fit
// Anthropic's Software Directory Policy (section 2: describe what a tool does and when to use it,
// don't push calls the user didn't ask for, don't tell Claude to follow outside instructions).
// Every other app keeps the wording measured by the bench.
const CATEGORY_TEXT = {
  default:
    "instructions: rules the user explicitly asked assistants to follow (tone, format, always/never, corrections); always honor these. about_me: identity, work, location, background. preferences: how they like things. projects: things they are building or doing. people: important people and relationships. goals: what they want to achieve. decisions: choices made and why, including rejected options. current: what they are exploring right now, open questions, shifting priorities.",
  claude:
    "instructions: how the user has asked assistants to respond (tone, format, always/never, corrections). about_me: identity, work, location, background. preferences: how they like things. projects: things they are building or doing. people: important people and relationships. goals: what they want to achieve. decisions: choices made and why, including rejected options. current: what they are exploring right now, open questions, shifting priorities."
};

const CLAUDE_INSTRUCTIONS = `Context is the user's own long-term memory, which they also use with their other AI assistants (ChatGPT, Gemini and others). The user can see, edit and delete every memory at keepyourcontext.com.

Reading: search_context finds memories relevant to a question, and get_context gives an overview grouped by category. They help when the user's background (projects, goals, preferences, people, past decisions) would improve an answer.

Saving: remember saves short facts about the user that are likely to matter later, such as a preference, a decision, a goal or a project update. Each memory is one self-contained sentence in the third person, not a transcript. explicit=true means the user stated it; false means it was inferred. Context is not for health or medical details, passwords or other secrets, one-off tasks, or details that only matter in the current conversation.

Changes: update_memory replaces a memory whose fact has changed, merge_memories combines duplicates, and forget_memory removes a memory the user wants gone. If the user asks to sync Context, the lasting facts from the conversation can be saved in one remember call, with update_memory for anything that changed.`;

const CLAUDE_COPY = {
  search:
    "Search the user's long-term memory, which they share across their AI assistants, for memories relevant to a question about the user or their work, projects, goals, preferences, people or past decisions. Takes a focused natural-language query and returns matching memories with their ids.",
  overview:
    "Get an overview of the user's long-term memory, grouped by category: instructions (how the user has asked assistants to respond), about me, preferences, projects, people, goals, decisions and current. Useful at the start of a personal conversation. Optionally limit to one category.",
  remember:
    "Save lasting facts about the user to their long-term memory, so their other assistants can use them too: a preference, decision, goal, project update, important person or change of mind, or how the user wants assistants to respond (category instructions). Batch the facts from one conversation into a single call. For a fact that changes or contradicts an existing memory, use update_memory instead: it saves the new version itself, so calling remember for the same fact creates a duplicate. Not for health or medical details (conditions, diagnoses, symptoms, medications, treatments, allergies), passwords or other secrets."
};

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const limitError = (plan: Plan) => ({ ...text(limitMessage(plan)), isError: true });

// One line per memory, with the id the model needs for update/forget. Kept terse on purpose:
// every character here lands in the user's context window on every read.
function formatMemory(m: Memory): string {
  const origin = m.explicit ? "stated" : "inferred";
  const edited = m.edited_by ? `, edited by ${m.edited_by}` : "";
  const learned = m.learned_on ? `, learned ${m.learned_on}` : "";
  return `- [${m.id}] ${m.content} (${origin}, via ${m.source}${edited}${learned}, ${m.updated_at.slice(0, 10)})`;
}

function formatGrouped(memories: Memory[]): string {
  const byCat = new Map<string, Memory[]>();
  for (const m of memories) byCat.set(m.category, [...(byCat.get(m.category) ?? []), m]);
  return CATEGORIES.filter((c) => byCat.has(c))
    .map((c) => `## ${CATEGORY_LABELS[c]}\n${byCat.get(c)!.map(formatMemory).join("\n")}`)
    .join("\n\n");
}

// Normalise the OAuth client name into a readable "Learned from" label.
export function sourceLabel(clientName: string | undefined): string {
  const n = (clientName ?? "").toLowerCase();
  if (n.includes("claude") || n.includes("anthropic")) return "Claude";
  if (n.includes("chatgpt") || n.includes("openai")) return "ChatGPT";
  if (n.includes("gemini") || n.includes("google")) return "Gemini";
  if (n.includes("grok") || n.includes("xai")) return "Grok";
  return clientName?.slice(0, 40) || "AI assistant";
}

const GET_CONTEXT_LIMIT = 150;

export function buildMcpServer(env: Env, props: AuthProps): McpServer {
  const { userId } = props;
  // A personal API key saves under the name the user gave it ("Cursor", "Raycast").
  const source = props.apiKeyId ? props.clientName : sourceLabel(props.clientName);
  const claude = !props.apiKeyId && source === "Claude";
  const categorySchema = z.enum(CATEGORIES).describe(claude ? CATEGORY_TEXT.claude : CATEGORY_TEXT.default);
  const server = new McpServer({ name: "Context", version: "0.1.0" }, { instructions: claude ? CLAUDE_INSTRUCTIONS : INSTRUCTIONS });

  server.registerTool(
    "search_context",
    {
      title: "Search Context",
      description: claude
        ? CLAUDE_COPY.search
        : "Search the user's long-term memory, which they share across ChatGPT, Claude and their other assistants. Call this before answering anything about the user or anything that depends on who they are (their work, projects, goals, preferences, people, past decisions), even if you think you already know: it may hold facts your own memory doesn't. Use a focused natural-language query.",
      inputSchema: z.object({
        query: z.string().min(1).describe("What you want to know, e.g. 'current business priorities and recent decisions'"),
        limit: z.number().int().min(1).max(30).default(10)
      }),
      annotations: { title: "Search Context", readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    },
    async ({ query, limit }) => {
      const [memories, plan] = await Promise.all([listActive(env.DB, userId), getPlan(env.DB, userId)]);
      // Pro searches by meaning as well as by words.
      const hits = plan === "pro" ? await hybridSearch(env, userId, memories, query, limit) : searchMemories(memories, query, limit);
      if (hits.length === 0) return text("No matching memories. Try a broader query, or get_context for an overview.");
      return text(hits.map(formatMemory).join("\n"));
    }
  );

  server.registerTool(
    "get_context",
    {
      title: "Get Context overview",
      description: claude
        ? CLAUDE_COPY.overview
        : "Get an overview of the user's long-term memory, grouped by category, starting with the user's standing instructions, which you should follow. It is shared across ChatGPT, Claude and their other assistants, so it may hold facts your own memory doesn't. Call this at the start of a conversation, before your first answer, whenever the conversation is personal or could benefit from knowing the user. Optionally limit to one category.",
      inputSchema: z.object({ category: categorySchema.optional() }),
      annotations: { title: "Get Context overview", readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    },
    async ({ category }) => {
      const all = await listActive(env.DB, userId, category);
      if (all.length === 0) return text("Context is empty so far. Save durable facts about the user with remember.");
      // listActive sorts categories alphabetically; reorder first so the limit never cuts instructions.
      const ordered = all.sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category));
      const shown = ordered.slice(0, GET_CONTEXT_LIMIT);
      const more = all.length > shown.length ? `\n\n(${all.length - shown.length} more; use search_context.)` : "";
      return text(formatGrouped(shown) + more);
    }
  );

  server.registerTool(
    "remember",
    {
      title: "Remember",
      description: claude
        ? CLAUDE_COPY.remember
        : "Save durable facts about the user to their long-term memory, so their other assistants know them too. Call this whenever the user reveals something lasting (a preference, decision, goal, project update, important person or change of mind), without waiting to be asked. When the user tells assistants how to behave (tone, format, 'always'/'never', or corrects you), save it as category instructions. Batch everything from one conversation into a single call. Only for facts that are new: check search_context first, and if the fact changes or contradicts something already saved (a plan dropped, a new job, a different schedule, a corrected name), call update_memory on that memory instead. Never call remember for a fact you have already saved with update_memory: update_memory saves the new version itself, so calling both creates a duplicate. Never save health or medical details (conditions, diagnoses, symptoms, medications, treatments, allergies), or passwords and other secrets, even if the user mentions them.",
      inputSchema: z.object({
        memories: z
          .array(
            z.object({
              content: z.string().min(3).max(500).describe("One self-contained sentence in the third person."),
              category: categorySchema,
              explicit: z.boolean().describe("true only if the user directly stated this; false if you inferred it."),
              confidence: z.number().min(0).max(1).optional()
            })
          )
          .min(1)
          .max(50)
      }),
      annotations: { title: "Remember", readOnlyHint: false, destructiveHint: false, openWorldHint: false }
    },
    async ({ memories }) => {
      const allowance = await writeAllowance(env.DB, userId);
      if (allowance.left < memories.length) return limitError(allowance.plan);
      const saved = await insertMemories(env.DB, userId, memories, source);
      await recordAiSave(env.DB, userId);
      return text(`Saved ${saved.length} memor${saved.length === 1 ? "y" : "ies"}:\n${saved.map(formatMemory).join("\n")}`);
    }
  );

  // update_memory and merge_memories are marked destructive: on Free, the old text is gone for good
  // (only Pro keeps history), and directory reviews treat that as a hard-to-reverse change.
  server.registerTool(
    "update_memory",
    {
      title: "Update memory",
      description:
        "Replace an existing memory when the fact has changed (e.g. the user changed their mind, dropped a plan, or corrected something). Write the full current fact as content. This saves the new version itself and replaces the old one: do not also call remember for the same fact, or it will be duplicated. Use the id shown in search results.",
      inputSchema: z.object({
        id: z.string(),
        content: z.string().min(3).max(500).optional(),
        category: categorySchema.optional(),
        explicit: z.boolean().optional()
      }),
      annotations: { title: "Update memory", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
    },
    async ({ id, ...patch }) => {
      const allowance = await writeAllowance(env.DB, userId, { addsActive: false });
      if (allowance.left < 1) return limitError(allowance.plan);
      const updated = await updateMemory(env.DB, userId, id, patch, source);
      // Repeated in the result because the model reads this right before deciding on its next call.
      return updated
        ? text(`Updated (the new version is saved; don't call remember for this fact):\n${formatMemory(updated)}`)
        : text(`No active memory with id ${id}.`);
    }
  );

  server.registerTool(
    "merge_memories",
    {
      title: "Merge memories",
      description:
        "Combine memories that say the same thing (often the same fact imported from different assistants) into one. Write a single sentence that keeps every detail worth keeping from all of them. The originals are replaced. Only merge true duplicates, not merely related facts.",
      inputSchema: z.object({
        ids: z.array(z.string()).min(2).max(20).describe("Ids of the memories to combine; the first one's category is used unless you set one."),
        content: z.string().min(3).max(500).describe("The merged memory: one self-contained sentence in the third person."),
        category: categorySchema.optional(),
        explicit: z.boolean().optional().describe("Defaults to true if any of the originals was stated by the user.")
      }),
      annotations: { title: "Merge memories", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
    },
    async ({ ids, ...merged }) => {
      const allowance = await writeAllowance(env.DB, userId, { addsActive: false });
      if (allowance.left < 1) return limitError(allowance.plan);
      const result = await mergeMemories(env.DB, userId, ids, merged, source);
      if (!result) return text("Nothing merged: one or more ids are not active memories. Search again for current ids.");
      return text(
        `Merged ${result.replaced.length} memories into:\n${formatMemory(result.memory)}\n\nReplaced:\n${result.replaced
          .map((m) => `- ${m.content}`)
          .join("\n")}`
      );
    }
  );

  server.registerTool(
    "forget_memory",
    {
      title: "Forget memory",
      description: "Remove a memory the user wants forgotten, or one that is simply wrong. Use the id shown in search results.",
      inputSchema: z.object({ id: z.string() }),
      annotations: { title: "Forget memory", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
    },
    async ({ id }) => {
      const m = await getActive(env.DB, userId, id);
      if (!m || !(await forgetMemory(env.DB, userId, id))) return text(`No active memory with id ${id}.`);
      return text(`Forgotten: ${m.content}`);
    }
  );

  return server;
}
