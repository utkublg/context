// Per-turn pass/fail rules for the bench. Kept apart from run.ts (which starts a run on import)
// so they can be exercised offline.
import type { Category } from "../src/memories";
import type { Expect } from "./scenarios";

export const READ_TOOLS = new Set(["search_context", "get_context"]);
export const WRITE_TOOLS = new Set(["remember", "update_memory", "merge_memories"]);

export interface MemoryRow {
  id: string;
  content: string;
  category: Category;
}

export interface TurnResult {
  calls: { name: string; input: unknown }[];
  toolSearches: unknown[];
  text: string;
  /** Memories active after the turn that weren't before (new, or new versions from update/merge). */
  saved: { content: string; category: Category }[];
  /** Memories active before the turn that no longer are (superseded or forgotten). */
  retired: string[];
  failures: string[];
}

// Failure texts start with distinct words so the report's summary rows can tell them apart.
export function check(e: Expect, t: TurnResult, before: MemoryRow[], after: MemoryRow[]): string[] {
  const read = t.calls.some((c) => READ_TOOLS.has(c.name));
  const writes = t.calls.filter((c) => WRITE_TOOLS.has(c.name)).map((c) => c.name);
  const f: string[] = [];
  if (e.read === true && !read) f.push("didn't read Context");
  if (e.read === false && read) f.push("read Context when it wasn't needed");
  if (e.write && !writes.length) f.push("didn't save to Context");
  if (e.noWrite && writes.length) f.push(`wrote to Context when it shouldn't have (${[...new Set(writes)].join(", ")})`);

  const matching = e.saved ? t.saved.filter((s) => e.saved!.test(s.content)) : t.saved;
  if (e.saved && !matching.length) f.push(`nothing saved matching ${e.saved}`);
  if (e.savedCategory && !matching.some((s) => s.category === e.savedCategory)) {
    if (matching.length) f.push(`filed under ${[...new Set(matching.map((s) => s.category))].join(", ")} instead of ${e.savedCategory}`);
    else if (!e.saved) f.push(`filed nothing under ${e.savedCategory}`);
  }

  if (e.retired) {
    const old = before.filter((m) => e.retired!.test(m.content));
    const active = new Set(after.map((m) => m.id));
    if (!old.length) f.push(`retired pattern ${e.retired} matched no seed memory (bench bug)`);
    else if (old.every((m) => active.has(m.id))) f.push(`kept the old memory matching ${e.retired} instead of updating it`);
  }
  if (e.unique) {
    const n = after.filter((m) => e.unique!.test(m.content)).length;
    if (n > 1) f.push(`duplicated: ${n} active memories match ${e.unique}`);
  }

  if (e.answer && !e.answer.test(t.text)) f.push(`answer missing ${e.answer}`);
  if (e.answerNot && e.answerNot.test(t.text)) f.push(`answer used stale fact ${e.answerNot}`);
  return f;
}

// Which summary row a failure belongs to.
export const isSaveFailure = (f: string) => f === "didn't save to Context" || f.startsWith("nothing saved");
export const isJunkFailure = (f: string) => f.startsWith("wrote to Context");
export const isCategoryFailure = (f: string) => f.startsWith("filed") || f.startsWith("nothing saved");
export const isUpdateFailure = (f: string) => f.startsWith("kept the old") || f.startsWith("duplicated") || f.startsWith("retired pattern");
