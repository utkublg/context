import { CATEGORIES, CATEGORY_LABELS, type Memory } from "./memories";

// Exports are the user's own data, so they include everything we know about each active
// memory except internal bookkeeping (user id, supersede links).

/** One memory as the JSON export and the REST API show it. */
export function memoryJson(m: Memory) {
  return {
    id: m.id,
    content: m.content,
    category: m.category,
    said_by_user: m.explicit === 1,
    confidence: m.confidence,
    source: m.source,
    edited_by: m.edited_by ?? null,
    learned_on: m.learned_on ?? null,
    created_at: m.created_at,
    updated_at: m.updated_at
  };
}

export function exportJson(memories: Memory[], exportedAt: string): string {
  return JSON.stringify({ exported_at: exportedAt, count: memories.length, memories: memories.map(memoryJson) }, null, 2);
}

// Each bullet uses the import line format ("[category] [said] [date] sentence"), so this file
// can be pasted straight back into Context's import page, or into any assistant.
export function exportMarkdown(memories: Memory[], exportedAt: string): string {
  const sections = CATEGORIES.flatMap((cat) => {
    const items = memories.filter((m) => m.category === cat);
    if (items.length === 0) return [];
    const lines = items.map((m) => {
      const date = m.learned_on ?? m.created_at.slice(0, 10);
      return `- [${m.category}] [${m.explicit ? "said" : "inferred"}] [${date}] ${m.content.replace(/\s*\n\s*/g, " ")}`;
    });
    return [`## ${CATEGORY_LABELS[cat]}`, "", ...lines, ""];
  });
  // Details go in the heading, which the importer ignores, so re-importing skips nothing.
  return [`# My Context (exported ${exportedAt.slice(0, 10)}, ${memories.length} memories)`, "", ...sections].join("\n");
}
