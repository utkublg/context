import type { Article } from "../types";

const article: Article = {
  slug: "what-does-chatgpt-know-about-me",
  kind: "guide",
  title: "What Does ChatGPT Know About Me? How to See It",
  description:
    "See what ChatGPT remembers about you: where to find saved memories in settings, a prompt that reveals the rest, and how to fix or delete what's wrong.",
  published: "2026-11-11",
  body: `
<p><strong>The quick way to find out:</strong> open ChatGPT and go to <strong>Settings → Personalization → Memory</strong>. That shows the facts ChatGPT has saved about you. But that list isn't everything. ChatGPT can also learn from your past chats, and that part has no list. To see it, ask ChatGPT directly, or use our free, no-sign-up page: <a href="https://keepyourcontext.com/what-ai-knows">What does your AI think about you?</a></p>

<p>Here's how each method works, and how to clean up what's wrong.</p>

<h2>The two kinds of ChatGPT memory</h2>
<p>OpenAI describes ChatGPT's memory in two parts:</p>
<ul>
  <li><strong>Saved memories.</strong> Facts ChatGPT chose to keep, like "Has two kids" or "Prefers metric units". You can see these one by one, and edit or delete them.</li>
  <li><strong>Chat history.</strong> ChatGPT can also refer back to things you said in past chats. There's no list of this. It just shapes answers quietly.</li>
</ul>
<p>So "what does ChatGPT know about me?" has two answers. One you can read in settings. The other you have to ask about.</p>

<h2>Method 1: Check your saved memories in settings</h2>
<ol>
  <li>Open ChatGPT and click your profile picture or name.</li>
  <li>Go to <strong>Settings</strong>, then <strong>Personalization</strong>.</li>
  <li>Find the <strong>Memory</strong> section. Choose <strong>Manage</strong> (on some accounts it's called <strong>Manage memories</strong> or <strong>Saved memories</strong>).</li>
  <li>Scroll the list. Each line is one thing ChatGPT has saved about you.</li>
</ol>
<p>Depending on your account, you may also see:</p>
<ul>
  <li><strong>Memory summary:</strong> a short overview of what ChatGPT may use to personalize answers. OpenAI says you can type a correction, highlight text to correct it, or pick "Don't mention this again" where that option shows.</li>
  <li><strong>Reference saved memories:</strong> a switch that turns saved memories on or off.</li>
  <li><strong>Reference chat history:</strong> a switch that lets ChatGPT use your past chats, or not.</li>
</ul>
<p>OpenAI changes these screens often, and not every account sees the same options. If yours look different, check OpenAI's help page: <a href="https://help.openai.com/en/articles/8590148-memory-in-chatgpt">Memory in ChatGPT</a>.</p>

<h3>Also check Custom instructions</h3>
<p>While you're in <strong>Personalization</strong>, look at <strong>Custom instructions</strong> too. That's where you (or past you) told ChatGPT what to call you, what you do, and how to reply. ChatGPT sees this in every chat.</p>

<h2>Method 2: Ask ChatGPT what it knows</h2>
<p>The settings list misses anything ChatGPT picked up from chat history. The easiest way to see that is to ask. Paste this into a new chat:</p>
<blockquote>
  <p>List everything you know or believe about me, from your saved memories and from our past chats. One fact per line. Mark each line "said" if I told you directly, or "guessed" if you worked it out yourself. Don't leave anything out to be polite.</p>
</blockquote>
<p>Two tips:</p>
<ul>
  <li><strong>Read the "guessed" lines closely.</strong> That's where the surprises are. ChatGPT may have decided you're a night owl, or that you're planning a wedding, just from what you asked about.</li>
  <li><strong>If the answer stops early, say "continue".</strong> Long lists can get cut off.</li>
</ul>
<p>Keep in mind that this is ChatGPT describing itself. It can miss things or add things. It's a good picture, not an official record.</p>

<h2>Method 3: Use our free page (no sign-up)</h2>
<p>We made a page that does Method 2 for you, with a better prompt: <a href="https://keepyourcontext.com/what-ai-knows">keepyourcontext.com/what-ai-knows</a>.</p>
<ol>
  <li>Copy the message on the page.</li>
  <li>Paste it into ChatGPT, Claude or Gemini. Use the one you talk to most.</li>
  <li>Read what it thinks it knows. Lines marked <strong>said</strong> are things you told it. Lines marked <strong>inferred</strong> are things it only guessed.</li>
</ol>
<p>It's free and you don't need an account. It's also fun to try in two different apps and compare. They rarely agree.</p>

<h2>How to fix or delete what ChatGPT knows</h2>
<h3>Delete one memory</h3>
<p>In <strong>Settings → Personalization → Memory → Manage</strong>, delete the line you don't want. You can also just tell ChatGPT in a chat: "Forget that I live in Leeds."</p>
<h3>Remove it for good</h3>
<p>OpenAI notes that deleting a saved memory doesn't delete the chat where you said it. If chat history is on, ChatGPT may still pick it up from that chat. To fully remove something, delete both the saved memory and the original chat.</p>
<h3>Turn memory off</h3>
<p>Switch off <strong>Reference saved memories</strong> and <strong>Reference chat history</strong> in the Memory settings. OpenAI says turning off saved memories also turns off chat history.</p>
<h3>Chat without memory</h3>
<p>Use a <strong>Temporary Chat</strong> when you don't want a conversation to shape what ChatGPT knows. Temporary chats don't use or update memory.</p>
<h3>Correct a wrong guess</h3>
<p>Tell ChatGPT plainly: "That's wrong. I'm not vegetarian, I just like vegetables." Then check the memory list to see it changed.</p>

<h2>What about Claude, Gemini and Grok?</h2>
<p>They all keep their own memory now, and each one keeps its own version of you. What ChatGPT knows, Claude doesn't, and the other way round. The prompt above works in any of them. If you're moving from one to another, see <a href="/guides/transfer-chatgpt-memory-to-claude">How to transfer ChatGPT memory to Claude</a>.</p>

<h2>One memory you can actually see</h2>
<p>The real problem isn't just seeing what ChatGPT knows. It's that every AI app keeps a different, half-hidden copy of you, and you can't easily check any of them.</p>
<p><a href="https://keepyourcontext.com">Context</a> gives all your AI apps one shared memory that you can read in full. It works with ChatGPT, Claude, Gemini and Grok. Each memory shows:</p>
<ul>
  <li>Whether you said it, or an AI guessed it (marked <strong>AI guessed</strong>)</li>
  <li>Which AI saved it, and when</li>
  <li>Buttons to confirm, edit or forget it</li>
</ul>
<p>You can search it, download it as Markdown or JSON, and delete one memory or everything. It's never sold and never used to train AI. To connect it, see <a href="/guides/add-custom-mcp-connector-chatgpt-claude-gemini-grok">How to add a custom connector in ChatGPT, Claude, Gemini and Grok</a>.</p>

<h2>Common questions</h2>
<h3>Can ChatGPT see my other apps or my files?</h3>
<p>Only if you connected them. Check <strong>Settings → Apps</strong> (or Connectors on some accounts) to see what's connected, and remove anything you don't use.</p>
<h3>Does ChatGPT remember things I deleted?</h3>
<p>A deleted saved memory is gone from the list. But if the chat it came from still exists and chat history is on, ChatGPT may still use it. Delete the chat too.</p>
<h3>Is memory on by default?</h3>
<p>For most personal accounts, yes. Check the Memory switches in Personalization to be sure.</p>

<p>Curious what your AI really thinks about you? <a href="https://keepyourcontext.com/what-ai-knows">Try the free page</a>. If you like what you see, <a href="https://keepyourcontext.com/login">set up Context for free</a>, fix the bad guesses, and let every AI app work from the same, correct version of you.</p>
`
};

export default article;
