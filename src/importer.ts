import { CATEGORIES, type Category, type NewMemory } from "./memories";

// The user pastes this into the assistant that knows them best. The assistant does the
// extraction on the user's own subscription, so importing costs us no LLM calls. The
// line format is strict enough to parse without a model, but still readable to a human.
// `why` opens the message and `after` replaces the closing request; the rules in between
// are shared, so an answer to either prompt can be imported.
const importPrompt = (why: string, after: string) => `${why} Please list everything durable you know about me: both your stored/saved memories about me and what you've learned from our past conversations.

Rules:
- One fact per line, as a short self-contained sentence in the third person ("Prefers ...", "Is building ..."). Keep my exact words in quotes for rules and strong opinions.
- Start each line with a category tag, a source tag and a date tag, exactly like this:
  [category] [said] [YYYY-MM-DD] sentence
  [category] [inferred] [unknown] sentence
- Categories (use exactly these): ${CATEGORIES.join(", ")}
  - instructions: rules I've explicitly asked you to follow (tone, format, "always/never ...", corrections). Only from your stored memories, not one-off requests within a single chat. Quote my exact words.
  - about_me: identity, work, location, background
  - preferences: communication style, food, travel, purchases, how I like to work
  - projects: ONE line per project, starting with the project name, then what it is, its status and key decisions
  - people: important people in my life and who they are to me
  - goals: career, financial, fitness, personal goals
  - decisions: important choices, why I made them, options I rejected
  - current: what I'm exploring right now, open questions, shifting priorities
- Use [said] only if I told you directly; use [inferred] if you concluded it yourself.
- Date: when you learned it, if you know; otherwise [unknown]. Within each category, list oldest first.
- Only include things likely to still matter in a few months. Skip one-off tasks and anything sensitive (passwords, account numbers, health details I haven't asked you to remember).
- Put all the lines in a single code block, with no headings or commentary inside it.
- ${after}

Example:
\`\`\`
[instructions] [said] [2024-03-02] Wants answers without filler: "never start with 'Great question'".
[preferences] [said] [unknown] Prefers concise answers without long introductions.
[projects] [said] [2024-06-10] Context: a portable AI memory over MCP; MVP live on Cloudflare Workers, chose no LLM on the import path.
[decisions] [said] [2023-11-20] Decided to stop pursuing cybersecurity to focus on entrepreneurship.
[current] [inferred] [unknown] Seems to be weighing whether to raise money or bootstrap.
\`\`\``;

export const IMPORT_PROMPT = importPrompt(
  "I'm moving my long-term memory into a tool called Context so all my AI assistants can share it.",
  'After the code block, say whether this is everything or more remain, so I can reply "continue".'
);

// For the public "What does your AI think about you?" page: the same list, plus a fun
// summary to screenshot. The summary sits outside the code block, so the answer still imports.
export const CURIOUS_PROMPT = importPrompt(
  "I'm curious what you know about me.",
  'After the code block, say whether this is everything or more remain, so I can reply "continue". Then, in plain words: describe me in one sentence, and tell me which guess about me you are least sure of.'
);

const LINE =
  /^\s*(?:[-*•]|\d+[.)])?\s*\[([a-z_ ]+)\]\s*\[(said|inferred)\]\s*(?:\[(\d{4}-\d{2}-\d{2}|unknown)\]\s*)?(.+?)\s*$/i;
const FENCE = /^\s*```/;
const HEADING = /^\s*#/;

// Real calendar dates only (Date.UTC rolls 2024-02-30 over to March), and not in the
// future. One day of slack so a user ahead of UTC can still date something "today".
function learnedOn(tag: string | undefined): string | null {
  if (!tag || !/^\d{4}-\d{2}-\d{2}$/.test(tag)) return null;
  const [y, m, d] = tag.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  if (new Date(t).toISOString().slice(0, 10) !== tag) return null;
  return t <= Date.now() + 86_400_000 ? tag : null;
}

export interface ParseResult {
  memories: NewMemory[];
  skipped: string[];
}

export function parseImport(input: string): ParseResult {
  const memories: NewMemory[] = [];
  const skipped: string[] = [];
  const lines = input.split(/\r?\n/);
  // If the answer has code fences, the memories are inside them and unparseable lines outside
  // are the assistant's chatter ("That's everything..."), dropped quietly. A valid memory line
  // outside a fence is still kept. Several pasted blocks are fine.
  const fenced = lines.some((l) => FENCE.test(l));
  let inside = false;
  for (const raw of lines) {
    if (FENCE.test(raw)) {
      inside = !inside;
      continue;
    }
    if (!raw.trim() || HEADING.test(raw)) continue;
    const m = LINE.exec(raw);
    const category = m?.[1].trim().toLowerCase().replace(/\s+/g, "_") as Category | undefined;
    if (!m || !category || !CATEGORIES.includes(category) || m[4].length < 3) {
      if (!fenced || inside) skipped.push(raw.trim());
      continue;
    }
    memories.push({
      category,
      explicit: m[2].toLowerCase() === "said",
      content: m[4].slice(0, 500),
      learned_on: learnedOn(m[3])
    });
  }
  return { memories, skipped };
}
