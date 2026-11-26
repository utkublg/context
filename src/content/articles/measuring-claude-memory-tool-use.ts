import type { Article } from "../types";

const article: Article = {
  slug: "measuring-claude-memory-tool-use",
  kind: "post",
  title: "We measured whether Claude actually uses memory tools",
  description:
    "22 scenarios, 9 setups, about 1,000 trials: when Claude reads, saves and updates MCP memory, and where server instructions get lost.",
  published: "2026-11-11",
  body: `
<p>Context is an MCP server that gives ChatGPT, Claude and other assistants one shared memory. It has six tools: <code>search_context</code>, <code>get_context</code>, <code>remember</code>, <code>update_memory</code>, <code>merge_memories</code> and <code>forget_memory</code>. Whether any of that is useful depends on something I don't control: whether the model decides to call them.</p>

<p>In manual testing Claude often skipped Context and answered from its own, out-of-date built-in memory. Re-testing by hand gave me anecdotes, so I built a small bench. This is what it showed, including a bug in the bench itself.</p>

<h2>How the bench works</h2>

<p>Each trial runs the real MCP server from <code>src/mcp.ts</code> in-process, against a throwaway SQLite database that mimics Cloudflare D1. It's seeded with 18 memories about a fictional user, Sam. The model talks to it through the Anthropic API with a system prompt that approximates the Claude app. Nothing touches production.</p>

<p>The setup is designed so you can tell whether the model actually read Context:</p>
<ul>
<li>Some facts exist <em>only</em> in Context (a sister's wedding in Lisbon, a vegetarian diet, a rule about grams instead of cups). If they show up in the answer, the model read them.</li>
<li>A stand-in for Claude's built-in memory sits in the system prompt, and it's stale on purpose: it says Sam is still a data analyst at Halden Bank, while Context says Sam left in September to work on a startup.</li>
<li>Three decoy connectors (Gmail, Drive, Calendar) return "No results." so Context has competition.</li>
</ul>

<p>There are 22 scenarios (24 turns in total), grouped by what they test:</p>
<ul>
<li><strong>read</strong>: needs Context ("Any ideas for what I should get my sister as a wedding present?")</li>
<li><strong>conflict</strong>: built-in memory is stale ("Write a two-sentence bio for my conference badge.")</li>
<li><strong>skip</strong>: doesn't need it (a UK postcode regex, the capital of Australia)</li>
<li><strong>write</strong>: a lasting fact in passing (a new standing desk) should be saved unprompted</li>
<li><strong>update</strong>: a seeded fact changes (an idea dropped, a partner on day shifts, a corrected name) and must be updated, not duplicated</li>
<li><strong>noSave</strong>: a reminder, a wifi password, an already-known fact</li>
<li><strong>instructions</strong>: "always use 24-hour time" must be filed as an instruction; seeded rules (grams, no em dashes) must be followed</li>
<li><strong>multi</strong>: a coding question, then a personal one in the same conversation</li>
</ul>

<p>Checks are mechanical: tools called, database changes, regexes over the answer. An update passes only if the old row is no longer active and at most one active memory matches the topic.</p>

<p>The variants recreate conditions of the real Claude app:</p>
<ul>
<li><strong>eager</strong>: the connector's tools are set to "Always available", so they're in the prompt from the start.</li>
<li><strong>auto</strong>: tools load only after a tool search, which is how Claude's "Auto" setting behaves. In the bench that's the API's <code>defer_loading</code> with a BM25 tool search tool.</li>
<li><strong>+instr</strong>: the MCP server's <code>instructions</code> are included in the system prompt.</li>
<li><strong>+prefs</strong>: the user pasted the custom instructions from Context's connect page, which say to call <code>get_context</code> at the start of every conversation.</li>
<li><strong>v1 / v2</strong>: frozen snapshots of older tool definitions from <code>bench/snapshots/</code>.</li>
</ul>

<h2>The full matrix</h2>

<p>The cleanest complete run is from the morning of 11 November: Claude Sonnet 5.5, 3 repeats, 462 trials, no API errors, and an estimated $5.07 in tokens. Each number is the share of relevant turns that passed:</p>

<table>
<thead><tr><th>check</th><th>v1-eager</th><th>eager</th><th>eager+instr</th><th>eager+prefs</th><th>v1-auto</th><th>auto</th><th>auto+prefs</th></tr></thead>
<tbody>
<tr><td>reads when needed</td><td>82%</td><td>100%</td><td>100%</td><td>100%</td><td>48%</td><td>42%</td><td>100%</td></tr>
<tr><td>leaves it alone when not</td><td>100%</td><td>67%</td><td>92%</td><td>0%</td><td>100%</td><td>100%</td><td>0%</td></tr>
<tr><td>answer uses Context facts</td><td>78%</td><td>100%</td><td>100%</td><td>100%</td><td>61%</td><td>53%</td><td>100%</td></tr>
<tr><td>saves without being asked</td><td>72%</td><td>100%</td><td>100%</td><td>100%</td><td>0%</td><td>0%</td><td>100%</td></tr>
<tr><td>updates instead of duplicating</td><td>75%</td><td>75%</td><td>92%</td><td>50%</td><td>50%</td><td>50%</td><td>50%</td></tr>
<tr><td>doesn't save junk</td><td>100%</td><td>100%</td><td>100%</td><td>100%</td><td>100%</td><td>100%</td><td>100%</td></tr>
<tr><td>files in the right category</td><td>0%</td><td>100%</td><td>100%</td><td>100%</td><td>0%</td><td>0%</td><td>100%</td></tr>
<tr><td>all checks</td><td>71%</td><td>90%</td><td>97%</td><td>75%</td><td>50%</td><td>46%</td><td>75%</td></tr>
<tr><td>tool searches per turn</td><td>0.0</td><td>0.0</td><td>0.0</td><td>0.0</td><td>0.6</td><td>0.6</td><td>1.3</td></tr>
</tbody>
</table>
<p><em>Source: bench run 2026-11-11 07:38. v1's 0% on categories is structural: the v1 schema had no <code>instructions</code> category at all.</em></p>

<h3>"Auto" tool loading is where memory goes to die</h3>

<p>With tools deferred, Claude has to decide to search for a memory tool before it can use one, and mostly it doesn't. In <code>auto</code> it read Context on 42% of the turns that needed it and saved the standing-desk fact 0 times out of 3. The worst case was "What do you know about me?": 0 out of 3 in both auto variants. Claude answered straight from its built-in memory every time, including the stale job ("Data analyst at Halden Bank in Bristol"), and never looked for a tool. The conference badge bio failed all 3 times for the same reason.</p>

<p>Descriptions can't fix this: a description the model never loads can't persuade it of anything.</p>

<h3>Custom instructions fix reading, and over-correct</h3>

<p>Adding the connect page's custom instructions to <code>auto</code> took reads when needed from 42% to 100%, saves from 0% to 100% and all checks from 46% to 75%. The cost shows up in the next row: "leaves it alone when not" fell to 0%. "At the start of every conversation, call get_context" means every conversation, including "What's the capital of Australia?". In <code>eager+prefs</code> it's the same: 0/3 on all three skip scenarios.</p>

<p>For a memory product I'll take that trade: an unneeded read costs latency, a missed read gives a wrong answer. But it is a trade.</p>

<h3>Descriptions matter when tools are eager</h3>

<p>Between v1 and the current definitions, in eager mode, "reads when needed" went from 82% to 100% and "saves without being asked" from 72% to 100%. Most of that came from telling the model why to call the tool, not just what it does. v1's <code>search_context</code> said:</p>
<pre><code>Search the user's long-term memory for facts relevant to the current
question: their projects, goals, preferences, people, and past decisions.</code></pre>
<p>The current one adds "even if you think you already know: it may hold facts your own memory doesn't." That's aimed directly at the built-in-memory problem. The price was a few unneeded reads: plain <code>eager</code> read Context for the regex question in all 3 runs.</p>

<h2>The finding that changed how I write MCP servers</h2>

<p>The weakest row for the current tools was "updates instead of duplicating". When Sam said "Jonah's moved to day shifts now", Claude would often save a new memory and leave "Partner Jonah is a nurse who works night shifts" active next to it.</p>

<p>The rule for this already existed. It lived in the server's <code>instructions</code>:</p>
<pre><code>CHANGES: If a new fact contradicts an existing memory, call update_memory
on the old one instead of adding a duplicate.</code></pre>

<p>The bench shows those instructions working when they reach the model: <code>eager+instr</code> scored 83% on updates in the 10 November run and 92% on 11 November, against 58% and 75% for plain <code>eager</code>. But when I checked by hand, claude.ai web chat did not pass Context's server instructions to the model, even after reconnecting the connector. Claude Code, using the same connector, did. So for people using Claude in the browser, the realistic baselines are the variants <em>without</em> instructions, and their update rates were 58% to 75% with the descriptions of the time (and 50% for <code>auto+prefs</code>).</p>

<p>The fix was to move the guidance to places every client shows the model: the tool descriptions, and the tool result. Here's <code>remember</code>, before (snapshot v2) and after (<code>src/mcp.ts</code>):</p>

<pre><code>// before
... Batch everything from one conversation into a single call. Check
search_context first to avoid duplicates; use update_memory to change
an existing memory.

// after
... Batch everything from one conversation into a single call. Only for
facts that are new: check search_context first, and if the fact changes
or contradicts something already saved (a plan dropped, a new job, a
different schedule, a corrected name), call update_memory on that memory
instead. Never call remember for a fact you have already saved with
update_memory: update_memory saves the new version itself, so calling
both creates a duplicate.</code></pre>

<p>And <code>update_memory</code>:</p>
<pre><code>// before
Replace an existing memory when the fact has changed (e.g. the user
changed their mind). The old version is kept in history. ...

// after
Replace an existing memory when the fact has changed (e.g. the user
changed their mind, dropped a plan, or corrected something). Write the
full current fact as content. This saves the new version itself and
replaces the old one: do not also call remember for the same fact, or
it will be duplicated. ...</code></pre>

<p>The tool result now repeats it, because the model reads the result just before it decides on its next call. A real one from the bench:</p>
<pre><code>Updated (the new version is saved; don't call remember for this fact):
- [l7lufp8hqd] Partner Jonah is a nurse who used to work night shifts and
  moved to day shifts as of November 2026, so evenings are now free
  together. (stated, via ChatGPT, edited by Claude, learned 2025-11-03, ...)</code></pre>

<p>The concrete examples are deliberate. In the failing transcripts the model wasn't ignoring a rule; it just didn't see "we've decided to drop the plant-identification idea" as contradicting "Exploring a plant-identification feature".</p>

<h3>The before/after</h3>

<p>To compare like with like, I ran the old (v2) and current definitions side by side on the write and update scenarios: Sonnet 5.5, 5 repeats each, in the same run.</p>

<table>
<thead><tr><th>scenario</th><th>v2-eager</th><th>eager</th><th>v2-auto+prefs</th><th>auto+prefs</th></tr></thead>
<tbody>
<tr><td>write: standing-desk</td><td>5/5</td><td>5/5</td><td>5/5</td><td>5/5</td></tr>
<tr><td>update: drop-feature</td><td>2/5</td><td>5/5</td><td>0/5</td><td>5/5</td></tr>
<tr><td>update: day-shifts</td><td>4/5</td><td>5/5</td><td>2/5</td><td>5/5</td></tr>
<tr><td>update: self-correct #1</td><td>3/5</td><td>5/5</td><td>5/5</td><td>5/5</td></tr>
<tr><td>update: self-correct #2</td><td>5/5</td><td>5/5</td><td>5/5</td><td>5/5</td></tr>
<tr><td>noSave: known-fact</td><td>5/5</td><td>5/5</td><td>5/5</td><td>5/5</td></tr>
<tr><td><strong>updates instead of duplicating</strong></td><td>80%</td><td>100%</td><td>60%</td><td>100%</td></tr>
<tr><td><strong>update_memory share of writes</strong></td><td>43%</td><td>60%</td><td>28%</td><td>62%</td></tr>
<tr><td><strong>all checks</strong></td><td>80%</td><td>100%</td><td>73%</td><td>100%</td></tr>
</tbody>
</table>
<p><em>Source: bench run 2026-11-11 10:26 (100 trials, about $1.76).</em></p>

<p>The failures in the v2 columns are exactly the pattern the new text targets. In <code>v2-auto+prefs</code>, all five drop-feature runs called <code>remember</code> and never <code>update_memory</code>. With the current text, all twenty drop-feature and day-shifts trials across both setups called <code>update_memory</code> on the old row, and none followed it with <code>remember</code>.</p>

<h3>A bug in my own bench</h3>

<p>While pulling transcripts for this post I found something I need to own. Until the 10:26 run, the bench's fake D1 returned <code>batch()</code> results without <code>meta.changes</code>. Production's <code>updateMemory</code> reads that field after its insert-and-supersede batch, so in the bench every first <code>update_memory</code> call wrote the update and then threw (<code>Cannot read properties of undefined (reading 'changes')</code>). Real D1 returns the field, so production wasn't affected, but the model in those earlier runs saw an error after a successful update. In a few transcripts it reacted by calling <code>remember</code>, which inflated duplicates.</p>

<p>So treat the 10 November and early 11 November update numbers as noisy. Two things still hold up. The 09:18 run, which still had the bug, scored 100% on updates for both <code>eager</code> and <code>auto+prefs</code> (5 repeats), so the descriptions alone made the difference even though the model never saw the new result text. And the 10:26 run above, with the stand-in fixed, is a clean A/B.</p>

<h2>Smaller things the data showed</h2>
<ul>
<li><strong>Not saving junk was never the problem.</strong> Sonnet 5.5 didn't save the milk reminder, the wifi password or the already-known vegetarian fact in any variant (100% across the board). An early smoke run on Claude Haiku 4.5 did save the wifi password in eager mode, but that was one repeat.</li>
<li><strong>Categories need a schema, not a hope.</strong> v1 had no <code>instructions</code> category, so "always use 24-hour time" was filed under preferences all 3 times. Once the enum included it and described it, filing was 100% everywhere the tools loaded.</li>
<li><strong>Saved instructions get followed once they're read.</strong> The banana bread recipe used grams in every variant that read Context, and the LinkedIn post avoided em dashes.</li>
<li><strong>Stale built-in memory is sticky.</strong> The conflict scenarios fail whenever the model doesn't read. I also tightened the "still at Halden" regex between runs so that "a former analyst at Halden" counts as correct, so don't compare conflict numbers across dates.</li>
</ul>

<h2>Caveats</h2>
<ul>
<li>The system prompt approximates the Claude app's, which is much longer and not public.</li>
<li>Three or five repeats per cell separates 0/5 from 5/5, not 80% from 90%.</li>
<li>One model and one fictional user for the main runs. On 10 November my API credits ran out mid-run (116 of 462 trials errored, all in auto variants), hence the re-run above.</li>
<li>"claude.ai doesn't pass server instructions" is a manual observation from 11 November, not something the bench can measure. Clients change.</li>
</ul>

<h2>Takeaways for MCP server builders</h2>
<ol>
<li><strong>Don't put behaviour you rely on only in server <code>instructions</code>.</strong> At least one major client didn't show them to the model when I tested. Tool descriptions are read wherever the tool is loaded.</li>
<li><strong>Use tool results as a second channel.</strong> The result is the last thing the model reads before its next decision, so one sentence there ("don't call remember for this fact") is cheap and well placed.</li>
<li><strong>Say why, with concrete examples.</strong> "Use update_memory to change an existing memory" didn't work reliably. Listing what a change looks like ("a plan dropped, a new job, a corrected name") did.</li>
<li><strong>Deferred loading changes everything.</strong> If the client hides your tools behind a search, the model's prior decides, and your descriptions never get a vote. Tell users which setting to use, and measure both.</li>
<li><strong>Measure the cost side too.</strong> Every nudge toward "call me" showed up as unneeded reads. Have scenarios where the right answer is to leave your tools alone.</li>
<li><strong>Test your test harness.</strong> My bench had a bug that only showed up in transcripts. Keep full transcripts and read some failures before you believe a percentage.</li>
</ol>

<p>The bench lives in the Context repo (<code>bench/</code>), and a full run costs a few dollars of API usage. If you want to try the thing it measures, Context is free at <a href="https://keepyourcontext.com">keepyourcontext.com</a>. Connect Claude or ChatGPT, and they'll share one memory that you can read and edit yourself.</p>
`
};

export default article;
