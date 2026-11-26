// Minimal Anthropic Messages API client: plain fetch, retries, and token accounting.
import { readFileSync } from "node:fs";

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface MessageResponse {
  content: any[];
  stop_reason: string;
  usage: Usage;
}

/** ANTHROPIC_API_KEY from the environment, else from .dev.vars. Never logged. */
export function apiKey(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const line = readFileSync(".dev.vars", "utf8").split("\n").find((l) => l.startsWith("ANTHROPIC_API_KEY="));
    const key = line?.slice("ANTHROPIC_API_KEY=".length).trim().replace(/^"|"$/g, "");
    if (key) return key;
  } catch {}
  throw new Error("No ANTHROPIC_API_KEY. Add ANTHROPIC_API_KEY=... to .dev.vars (it is gitignored).");
}

export async function createMessage(key: string, body: object): Promise<MessageResponse> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (res.ok) return (await res.json()) as MessageResponse;
    const retryable = res.status === 429 || res.status >= 500;
    const text = await res.text();
    if (!retryable || attempt >= 5) throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 500)}`);
    const wait = Number(res.headers.get("retry-after")) * 1000 || Math.min(60_000, 2000 * 2 ** attempt);
    await new Promise((r) => setTimeout(r, wait));
  }
}

// USD per million tokens [input, output], from platform.claude.com/docs/en/about-claude/pricing
// (checked 25 October 2026). Cache writes cost 1.25x input; cache reads are cheaper still,
// approximated here as 0.1x input. Unknown models report tokens only.
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-sonnet-5-5": [2, 10],
  "claude-sonnet-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-haiku-4-5-20251001": [1, 5]
};

export function cost(model: string, u: Usage): number | null {
  const p = PRICES[model];
  if (!p) return null;
  const input = u.input_tokens + 1.25 * (u.cache_creation_input_tokens ?? 0) + 0.1 * (u.cache_read_input_tokens ?? 0);
  return (input * p[0] + u.output_tokens * p[1]) / 1e6;
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_creation_input_tokens: (a.cache_creation_input_tokens ?? 0) + (b.cache_creation_input_tokens ?? 0),
    cache_read_input_tokens: (a.cache_read_input_tokens ?? 0) + (b.cache_read_input_tokens ?? 0)
  };
}
