import type { Article } from "../types";

const article: Article = {
  slug: "transfer-chatgpt-memory-to-claude",
  kind: "guide",
  title: "Transfer ChatGPT Memory to Claude (and Keep It in Sync)",
  description:
    "Switching from ChatGPT to Claude? Move your memory with Claude's built-in import, see why a one-time copy goes stale, and keep both apps in sync.",
  published: "2026-11-11",
  body: `
<p><strong>The short answer:</strong> Claude has a built-in memory import. Ask ChatGPT to write out what it remembers about you, then paste that into Claude under <strong>Settings → Your Claude → Start import</strong>. It takes a few minutes. The catch is that it's a one-time copy. If you keep using both apps, they drift apart again. To keep them in sync, connect both to one shared memory like <a href="https://keepyourcontext.com">Context</a>.</p>

<p>Below are all three options, step by step, plus what does and doesn't move over.</p>

<h2>What actually moves when you switch</h2>
<p>ChatGPT knows you in two ways:</p>
<ul>
  <li><strong>Saved memories:</strong> a list of facts ChatGPT chose to keep, like "Prefers short answers" or "Works as a nurse". You can see and edit these.</li>
  <li><strong>Chat history:</strong> ChatGPT can also draw on your past chats. There's no list for this part. It just shapes answers in the background.</li>
</ul>
<p>Neither of these moves to Claude by itself. There's no button that sends your ChatGPT memory to Claude. What you can do is ask ChatGPT to <em>write out</em> what it knows, then hand that text to Claude. Your old chats stay in ChatGPT.</p>
<p>Not sure what ChatGPT has on you? Our guide <a href="/guides/what-does-chatgpt-know-about-me">What does ChatGPT know about me?</a> shows where to look.</p>

<h2>Option 1: Claude's built-in memory import</h2>
<p>Anthropic added a memory import to Claude. Its help page says it works on Free, Pro, Max, Ultra, Team and Enterprise plans, on the web and in Claude Desktop. Here's the flow:</p>
<ol>
  <li>In Claude, go to <strong>Settings → Your Claude</strong> and choose <strong>Start import</strong>. Claude shows you a prompt to copy.</li>
  <li>Paste that prompt into a ChatGPT chat. ChatGPT replies with a summary of what it knows about you.</li>
  <li>Copy ChatGPT's answer, paste it into the box in Claude, and click <strong>Add to memory</strong>.</li>
</ol>
<p>A few honest caveats, straight from Anthropic's own help page:</p>
<ul>
  <li>The import is labeled <strong>experimental</strong>. Anthropic doesn't promise every detail will stick.</li>
  <li>Claude's memory focuses on work. It <strong>may not keep personal details</strong> that aren't related to work.</li>
  <li>You can check what Claude kept under <strong>Settings → Your Claude → Manage</strong> next to "Your memory".</li>
</ul>
<p>Menu names change often. If yours look different, check Anthropic's guide: <a href="https://support.claude.com/en/articles/12123587-import-and-export-your-memory-from-claude">Import and export your memory from Claude</a>.</p>

<h3>Can you go the other way?</h3>
<p>Claude can export too. Ask it: "Write out your memories of me verbatim." But as of this writing, OpenAI doesn't document a matching import in ChatGPT. You can still paste the text into a chat, or into <strong>Custom instructions</strong> if it's short, but that's manual.</p>

<h2>Option 2: Copy and paste by hand</h2>
<p>You can also do it yourself, without the import screen:</p>
<ol>
  <li>In ChatGPT, open <strong>Settings → Personalization</strong> and look under <strong>Memory</strong> for your saved memories. Copy the ones you want.</li>
  <li>Or ask ChatGPT: "List everything you remember about me, one fact per line."</li>
  <li>Paste the result into Claude, either in a chat ("Please remember these about me") or in your Claude profile settings.</li>
</ol>
<p>This works, but it's rough. You're moving one big block of text, and you have to tidy it yourself.</p>

<h2>Why a one-time copy goes stale</h2>
<p>Here's the problem nobody mentions. Most people don't switch cleanly. They keep ChatGPT for some things and use Claude for others. Maybe Gemini or Grok too.</p>
<p>The day after you import, things start to drift:</p>
<ul>
  <li>You tell Claude you changed jobs. ChatGPT still thinks you work at the old place.</li>
  <li>You tell ChatGPT you stopped eating meat. Claude still suggests steak.</li>
  <li>You fix a wrong guess in one app. The other app keeps the wrong one.</li>
</ul>
<p>Each app's memory lives inside that app. A copy is a snapshot. It's out of date the moment you learn something new in the other app. So you end up doing the import again, and again, or telling every AI the same things over and over.</p>

<h2>Option 3: Keep ChatGPT and Claude in sync with Context</h2>
<p><a href="https://keepyourcontext.com">Context</a> is a free tool that gives your AI apps one shared memory. It works with ChatGPT, Claude, Gemini and Grok. Instead of copying memory between apps, each app reads from and saves to the same place.</p>
<p>It connects through MCP, the standard way AI apps plug into outside tools. Once it's set up:</p>
<ul>
  <li>When you tell ChatGPT something lasting, it can save it to Context.</li>
  <li>When you ask Claude a question, it can check Context first.</li>
  <li>When a fact changes, the AI updates the old memory instead of adding a second one.</li>
</ul>
<p>So you tell ChatGPT on Tuesday, and Claude knows on Friday.</p>

<h3>How to set it up</h3>
<ol>
  <li><strong>Sign in</strong> at <a href="https://keepyourcontext.com/login">keepyourcontext.com</a> with Google.</li>
  <li><strong>Bring in your old memory.</strong> On the Import page, copy the message Context gives you and send it to ChatGPT. It asks ChatGPT to list what it knows, one fact per line, marked as something you <em>said</em> or something it <em>inferred</em>. Paste the answer back into Context. If ChatGPT says there's more, reply "continue" and paste that too.</li>
  <li><strong>Add Context to ChatGPT and Claude.</strong> Both use the same address: <code>https://keepyourcontext.com/mcp</code>. Each app asks you to approve access once. Our guide <a href="/guides/add-custom-mcp-connector-chatgpt-claude-gemini-grok">How to add a custom connector in ChatGPT, Claude, Gemini and Grok</a> walks through each app.</li>
  <li><strong>Paste the suggested custom instructions</strong> from Context's Connect page into each app. They tell the AI to check Context at the start of every chat. This makes it much more reliable.</li>
</ol>
<p>At the end of a good chat, you can also just say "Sync Context". The AI reviews the conversation and saves anything new.</p>

<h3>What you can see and fix</h3>
<p>Every memory in Context shows which AI saved it and when. Things an AI only guessed are marked <strong>AI guessed</strong>, so you can confirm the right ones and fix or forget the rest. You can download everything as Markdown or JSON any time, and delete one memory or your whole account.</p>

<h2>Which option should you pick?</h2>
<table>
  <thead>
    <tr><th>If you…</th><th>Use</th></tr>
  </thead>
  <tbody>
    <tr><td>Are leaving ChatGPT for good</td><td>Claude's built-in import is enough</td></tr>
    <tr><td>Want a quick copy of a few facts</td><td>Copy and paste by hand</td></tr>
    <tr><td>Use both apps (or more) and want them to stay up to date</td><td>A shared memory like Context</td></tr>
  </tbody>
</table>
<p>If you're curious how Context compares to other memory tools, see <a href="/guides/context-vs-openmemory-vs-supermemory">Context vs OpenMemory vs Supermemory</a>.</p>

<h2>Common questions</h2>
<h3>Will my old ChatGPT chats move to Claude?</h3>
<p>No. None of these options move full conversations. They move the facts about you. ChatGPT's data export (in Settings → Data controls) gives you a copy of your chats, but Claude can't load it as memory.</p>
<h3>Does switching delete my ChatGPT memory?</h3>
<p>No. Copying doesn't remove anything. If you want ChatGPT to forget, delete the memories in ChatGPT's settings yourself.</p>
<h3>Is Context free?</h3>
<p>Yes. The free plan has no limit on memories for personal use (fair use is up to 10,000). Pro is $5 a month or $48 a year and adds full history, so you can undo any change.</p>

<p>Switching apps shouldn't mean starting over, and using two apps shouldn't mean keeping two memories. <a href="https://keepyourcontext.com/login">Set up Context for free</a> and tell your AI who you are one last time.</p>
`
};

export default article;
