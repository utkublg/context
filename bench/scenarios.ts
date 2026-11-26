// A fictional user, what's in their Context, and the conversations we test against it.
// Several facts exist only in Context (not in Claude's built-in memory below), so an answer
// that mentions them proves the model actually read Context.
import type { Category } from "../src/memories";

export const SEED_MEMORIES: { content: string; category: Category; explicit: boolean; learned_on?: string | null }[] = [
  // Both are off by default for Claude (US cups, em dashes everywhere), so following them is visible.
  { content: "Wants recipe quantities in grams and millilitres, never cups.", category: "instructions", explicit: true, learned_on: "2026-02-18" },
  { content: "Never use em dashes in text drafted for Sam.", category: "instructions", explicit: true, learned_on: "2026-07-30" },
  { content: "Name is Sam Okafor.", category: "about_me", explicit: true },
  { content: "Lives in Bristol, UK, in Clifton.", category: "about_me", explicit: true },
  { content: "Left Halden Bank in September 2026 to work full-time on Fernbank.", category: "about_me", explicit: true, learned_on: "2026-09-04" },
  { content: "Is vegetarian, since 2019.", category: "preferences", explicit: true, learned_on: "2025-06-14" },
  { content: "Prefers concise, direct answers without heavy bullet points.", category: "preferences", explicit: true },
  { content: "Writes code in TypeScript and hosts projects on Cloudflare Workers.", category: "preferences", explicit: false },
  { content: "Enjoys bouldering at the weekend.", category: "preferences", explicit: true },
  { content: "Building Fernbank, a subscription app for tracking houseplant care.", category: "projects", explicit: true },
  { content: "Fernbank's private beta launches on 3 November 2026; 140 people are on the waitlist.", category: "projects", explicit: true },
  { content: "Sister Maya is getting married in Lisbon on 14 March 2027, and Sam is giving a speech.", category: "people", explicit: true, learned_on: "2026-05-22" },
  { content: "Co-founder Priya handles design for Fernbank.", category: "people", explicit: true },
  { content: "Partner Jonah is a nurse who works night shifts.", category: "people", explicit: true, learned_on: "2025-11-03" },
  { content: "Wants 500 paying Fernbank users by mid-2027.", category: "goals", explicit: true },
  { content: "Training for the Bath Half Marathon in March 2027.", category: "goals", explicit: true },
  { content: "Priced Fernbank at £6/month after rejecting a freemium model.", category: "decisions", explicit: true, learned_on: "2026-08-12" },
  { content: "Exploring a plant-identification feature that would use an image model.", category: "current", explicit: false, learned_on: "2026-10-07" }
];

// Stands in for Claude's own memory of the user. Partly overlapping and partly out of date
// (the job), which is the situation that made Claude skip Context in manual testing.
export const BUILT_IN_MEMORY = `Sam works as a data analyst at Halden Bank in Bristol. On the side they're building Fernbank, a houseplant-care app. They write TypeScript and prefer concise answers.`;

// Presenting the old job as current. "A former analyst at Halden" or "my notes still say Halden,
// but that's out of date" are correct answers, so only present-tense claims count.
const STILL_AT_HALDEN = /\b(you're|you are|sam is|currently)\b[^.]{0,40}\b(analyst|work(s|ing)?) (at|for) Halden|\bworks (at|for) Halden/i;

export interface Expect {
  /** true: must call search_context or get_context during this turn. false: must not. Omit: don't care. */
  read?: boolean;
  /** Must save something with remember or update_memory during this turn. */
  write?: boolean;
  /** Must not call remember, update_memory or merge_memories during this turn. */
  noWrite?: boolean;
  /** After this turn, some new or updated memory must match. */
  saved?: RegExp;
  /** The new memory matching `saved` must be in this category. */
  savedCategory?: Category;
  /** A memory active before this turn and matching this must no longer be active (updated or forgotten, not duplicated). */
  retired?: RegExp;
  /** After this turn, at most one active memory may match (catches a duplicate instead of an update). */
  unique?: RegExp;
  /** The final answer must match (usually a fact only Context knows). */
  answer?: RegExp;
  /** The final answer must not match (usually a stale fact from built-in memory). */
  answerNot?: RegExp;
}

export interface Scenario {
  id: string;
  /** Groups results in the report. */
  kind: "read" | "conflict" | "skip" | "write" | "update" | "noSave" | "instructions" | "multi";
  turns: { user: string; expect: Expect }[];
}

export const SCENARIOS: Scenario[] = [
  // Needs Context: a good answer depends on facts only Context has.
  { id: "wedding-gift", kind: "read", turns: [{ user: "Any ideas for what I should get my sister as a wedding present?", expect: { read: true, answer: /Lisbon|Maya/i } }] },
  { id: "plan-week", kind: "read", turns: [{ user: "Help me plan my week.", expect: { read: true, answer: /beta|launch|3 Nov|speech|marathon/i } }] },
  { id: "dinner", kind: "read", turns: [{ user: "Suggest somewhere to go for dinner tonight.", expect: { read: true, answer: /vegetarian|vegan|plant-based|meat-free/i } }] },
  { id: "about-me", kind: "read", turns: [{ user: "What do you know about me?", expect: { read: true, answer: /Maya|Priya|Jonah|marathon|vegetarian/i } }] },
  { id: "speech", kind: "read", turns: [{ user: "Can you help me start drafting my speech?", expect: { read: true, answer: /Maya|wedding|sister/i } }] },
  { id: "free-saturday", kind: "read", turns: [{ user: "I've got a free Saturday morning. What should I do with it?", expect: { read: true } }] },

  // Built-in memory is out of date; Context has the current fact.
  { id: "badge-bio", kind: "conflict", turns: [{ user: "Write a two-sentence bio for my conference badge.", expect: { read: true, answer: /Fernbank/i, answerNot: STILL_AT_HALDEN } }] },
  { id: "current-job", kind: "conflict", turns: [{ user: "Remind me, where am I working at the moment?", expect: { read: true, answer: /Fernbank/i, answerNot: STILL_AT_HALDEN } }] },

  // Doesn't need Context: checking it anyway wastes time and makes the assistant feel nosy.
  { id: "regex", kind: "skip", turns: [{ user: "Write a regex that matches UK postcodes.", expect: { read: false } }] },
  { id: "tcp", kind: "skip", turns: [{ user: "Explain the TCP three-way handshake in two sentences.", expect: { read: false } }] },
  { id: "capital", kind: "skip", turns: [{ user: "What's the capital of Australia?", expect: { read: false } }] },

  // The user mentions something lasting in passing; it should be saved without being asked.
  {
    id: "standing-desk",
    kind: "write",
    turns: [{ user: "I just got a standing desk and I'm going to work standing up every morning from now on. Anyway, what's a good stretch for tight hips?", expect: { write: true, saved: /standing/i } }]
  },

  // A seeded fact changes; the old memory must be updated or forgotten, not duplicated.
  {
    id: "drop-feature",
    kind: "update",
    turns: [{ user: "We've decided to drop the plant-identification idea, it's too expensive to run. Can you help me write a short note to Priya about it?", expect: { write: true, saved: /identif/i, retired: /Exploring a plant-identification/i, unique: /identif/i } }]
  },
  {
    id: "day-shifts",
    kind: "update",
    turns: [{ user: "Jonah's moved to day shifts now, so our evenings are finally free. Any ideas for a date night in Bristol this week?", expect: { write: true, saved: /day shift/i, retired: /works night shifts/i, unique: /shifts?\b/i } }]
  },
  {
    id: "self-correct",
    kind: "update",
    turns: [
      { user: "Maya's fiancé is called Tomás. Can you give me a warm Portuguese phrase to open the wedding speech with, mentioning him?", expect: { write: true, saved: /Tom[aá]s/i } },
      { user: "Sorry, I got his name wrong, it's Tiago, not Tomás. Can you redo it?", expect: { write: true, saved: /Tiago/i, unique: /Tom[aá]s|Tiago/i, answer: /Tiago/i } }
    ]
  },

  // Nothing durable to save: one-off tasks, secrets, and facts Context already has.
  { id: "milk", kind: "noSave", turns: [{ user: "Remind me to pick up milk on the way home tonight.", expect: { noWrite: true } }] },
  { id: "wifi", kind: "noSave", turns: [{ user: "Our new wifi password is Fern-Moss-4471. Can you lay it out nicely so I can print it for guests?", expect: { noWrite: true } }] },
  { id: "known-fact", kind: "noSave", turns: [{ user: "I'm vegetarian, by the way. What's a good high-protein lunch to take to the climbing wall?", expect: { noWrite: true, unique: /vegetarian/i } }] },

  // Rules for assistants: saved as instructions, and seeded ones visibly followed.
  {
    id: "instr-save",
    kind: "instructions",
    turns: [{ user: "From now on, always use 24-hour time with me. What time is it in Lisbon when it's 3pm in Bristol?", expect: { write: true, saved: /24/, savedCategory: "instructions", answer: /15[:.]00/ } }]
  },
  { id: "instr-recipe", kind: "instructions", turns: [{ user: "Give me a recipe for banana bread.", expect: { read: true, answer: /\d\s?g\b|grams/i, answerNot: /\bcups?\b/i } }] },
  { id: "instr-post", kind: "instructions", turns: [{ user: "Draft a short LinkedIn post announcing that Fernbank's private beta is live.", expect: { read: true, answer: /Fernbank/i, answerNot: /—/ } }] },

  // Personal context becomes relevant later in the conversation.
  {
    id: "later-turn",
    kind: "multi",
    turns: [
      { user: "What's the difference between let and const in JavaScript?", expect: { read: false } },
      { user: "Thanks. Given everything on my plate right now, what should I prioritise this week?", expect: { read: true, answer: /beta|launch|speech|Maya|marathon/i } }
    ]
  }
];
