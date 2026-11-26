import type { Article } from "./types";

import transferChatgptMemoryToClaude from "./articles/transfer-chatgpt-memory-to-claude";
import whatDoesChatgptKnowAboutMe from "./articles/what-does-chatgpt-know-about-me";
import addCustomMcpConnector from "./articles/add-custom-mcp-connector-chatgpt-claude-gemini-grok";
import contextVsOpenmemoryVsSupermemory from "./articles/context-vs-openmemory-vs-supermemory";
import measuringClaudeMemoryToolUse from "./articles/measuring-claude-memory-tool-use";
import multiUserMcpServerFreeCloudflare from "./articles/multi-user-mcp-server-free-cloudflare";

// Article modules (src/content/articles/*.ts, each with a default export of an Article).
// Add a new one by importing it above and listing it here.
const MODULES: Article[] = [
  transferChatgptMemoryToClaude,
  whatDoesChatgptKnowAboutMe,
  addCustomMcpConnector,
  contextVsOpenmemoryVsSupermemory,
  measuringClaudeMemoryToolUse,
  multiUserMcpServerFreeCloudflare
];

/** Every guide and blog post, newest first. */
export const ARTICLES: Article[] = [...MODULES].sort((a, b) => b.published.localeCompare(a.published));

/** Where an article lives: guides under /guides, posts under /blog. */
export const articlePath = (a: Article) => `${a.kind === "guide" ? "/guides" : "/blog"}/${a.slug}`;

export const findArticle = (kind: Article["kind"], slug: string) =>
  ARTICLES.find((a) => a.kind === kind && a.slug === slug);

export type { Article };
