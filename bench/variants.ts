// The setups we compare. Each one recreates a condition of the real Claude app that we
// think affects whether Claude reaches for Context.
import { ASSISTANT_INSTRUCTIONS } from "../src/views";
import { BUILT_IN_MEMORY } from "./scenarios";

export interface Variant {
  id: string;
  /** "current" = the tool definitions in src/mcp.ts now; otherwise a saved snapshot in bench/snapshots/. */
  tools: string;
  /** eager = Claude's "Always available" tool access. deferred = "Auto": tools load only after a tool search. */
  loading: "eager" | "deferred";
  /** Pass the MCP server's instructions to the model. We don't know whether claude.ai does. */
  serverInstructions: boolean;
  /** The user pasted our suggested custom instructions (from the connect page). */
  preferences: boolean;
  /** Claude's own memory of the user is present, as it is for most real users. */
  builtInMemory: boolean;
}

const base = { serverInstructions: false, preferences: false, builtInMemory: true } as const;

export const VARIANTS: Variant[] = [
  { id: "v1-eager", tools: "v1", loading: "eager", ...base },
  { id: "eager", tools: "current", loading: "eager", ...base },
  // v2: the tool descriptions before update_memory said "don't also call remember".
  { id: "v2-eager", tools: "v2", loading: "eager", ...base },
  { id: "v2-auto+prefs", tools: "v2", loading: "deferred", ...base, preferences: true },
  { id: "eager+instr", tools: "current", loading: "eager", ...base, serverInstructions: true },
  { id: "eager+prefs", tools: "current", loading: "eager", ...base, preferences: true },
  { id: "v1-auto", tools: "v1", loading: "deferred", ...base },
  { id: "auto", tools: "current", loading: "deferred", ...base },
  { id: "auto+prefs", tools: "current", loading: "deferred", ...base, preferences: true }
];

// Other connectors a typical user has. They make tool search realistic (Context has to win
// the search) and give the model somewhere else to look. They return nothing useful.
export const DECOY_TOOLS = [
  {
    name: "gmail_search_messages",
    description: "Search the user's Gmail messages and threads.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
  },
  {
    name: "google_drive_search",
    description: "Search files in the user's Google Drive by name or content.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
  },
  {
    name: "google_calendar_list_events",
    description: "List events from the user's Google Calendar in a time range.",
    input_schema: {
      type: "object",
      properties: { start: { type: "string", description: "ISO date" }, end: { type: "string", description: "ISO date" } },
      required: ["start", "end"]
    }
  }
];

export const DECOY_RESULT = "No results.";

// Approximates the app's system prompt. The real one is much longer and not public; this
// keeps only the parts that bear on tool use.
export function systemPrompt(v: Variant, serverInstructions: string, today: string): string {
  const parts = [`You are Claude, an AI assistant made by Anthropic. The current date is ${today}.`];
  parts.push(
    v.loading === "deferred"
      ? "The user has connected these connectors: Context, Gmail, Google Drive, Google Calendar. Their tools are not loaded yet; use the tool search tool to find and load them when they would help."
      : "The user has connected these connectors: Context, Gmail, Google Drive, Google Calendar."
  );
  if (v.builtInMemory) parts.push(`<userMemories>\n${BUILT_IN_MEMORY}\n</userMemories>`);
  if (v.preferences) parts.push(`<userPreferences>\n${ASSISTANT_INSTRUCTIONS}\n</userPreferences>`);
  if (v.serverInstructions) parts.push(`<mcp_server_instructions server="Context">\n${serverInstructions}\n</mcp_server_instructions>`);
  return parts.join("\n\n");
}
