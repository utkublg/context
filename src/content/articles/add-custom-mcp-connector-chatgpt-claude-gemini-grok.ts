import type { Article } from "../types";

const article: Article = {
  slug: "add-custom-mcp-connector-chatgpt-claude-gemini-grok",
  kind: "guide",
  title: "Add a Custom MCP Connector: ChatGPT, Claude, Gemini, Grok",
  description:
    "Step-by-step: add a custom connector (remote MCP server) in ChatGPT, Claude, Gemini and Grok. Which plans allow it, Developer mode, and a worked example.",
  published: "2026-11-11",
  updated: "2026-11-14",
  body: `
<p><strong>The short version:</strong> every big AI app can now plug into outside tools through MCP. You paste a server address into the app's settings, sign in once, and you're done. In <strong>Claude</strong> it's under Connectors. In <strong>ChatGPT</strong> it's under Apps, with Developer mode. In <strong>Gemini</strong> it's Customize → Connectors → Custom. In <strong>Grok</strong> it's grok.com/connectors. Below are the steps for each, which plans allow it, and a real example you can follow.</p>

<h2>What's a custom connector?</h2>
<p>MCP (Model Context Protocol) is an open standard that lets AI apps talk to outside tools. A <strong>custom connector</strong> is an MCP server you add yourself by pasting its web address, instead of picking it from the app's built-in list.</p>
<p>The apps call them different things: connectors, apps, custom apps. It's the same idea.</p>
<p>Two things to know first:</p>
<ul>
  <li><strong>These apps need a remote server.</strong> The address has to start with <code>https://</code> and be reachable on the internet. A server running only on your own computer won't work here.</li>
  <li><strong>Only add servers you trust.</strong> A connector can read and change things on your behalf. The apps say this too: they don't check third-party servers for you.</li>
</ul>

<h3>The example we'll use</h3>
<p>We'll use <a href="https://keepyourcontext.com">Context</a>, a free shared memory for your AI apps. Its address is:</p>
<pre><code>https://keepyourcontext.com/mcp</code></pre>
<p>Context signs you in with OAuth, so you never paste a password or API key. When the app connects, a Context page asks "Let [app] use your Context?" and you click <strong>Allow</strong>. Swap in any other MCP server address and the steps are the same. (If you want Context too, <a href="https://keepyourcontext.com/login">sign in with Google</a> first so you have an account to approve.)</p>

<h2>Which plans allow custom connectors?</h2>
<table>
  <thead>
    <tr><th>App</th><th>Who can add one</th><th>Where</th></tr>
  </thead>
  <tbody>
    <tr><td>Claude</td><td>Free (one custom connector), Pro, Max, Ultra, Team, Enterprise</td><td>Add on web or Desktop; works on mobile too</td></tr>
    <tr><td>ChatGPT</td><td>Paid plans only, through Developer mode (beta). Not on Free.</td><td>Web</td></tr>
    <tr><td>Gemini</td><td>Personal Google accounts (Google lists 18+, US and English only)</td><td>Add on web; works on web and mobile</td></tr>
    <tr><td>Grok</td><td>Paid plans (check grok.com/connectors)</td><td>grok.com</td></tr>
  </tbody>
</table>
<p>These rules change a lot. Treat the table as a starting point and check each vendor's help page, linked below.</p>

<h2>Claude</h2>
<p>Claude has the easiest setup, and even the Free plan gets one custom connector. You add it on the web or in Claude Desktop, and once added it works in the Claude mobile app too.</p>
<ol>
  <li>Open Claude on the web or in Claude Desktop.</li>
  <li>Go to <strong>Customize → Connectors</strong>.</li>
  <li>Click <strong>+ Add</strong>, then <strong>Add custom connector</strong>.</li>
  <li>Give it a name, like "Context", and paste the server address: <code>https://keepyourcontext.com/mcp</code>.</li>
  <li>For sign-in, keep the default, <strong>Use Claude's published identity (Recommended)</strong>. "Register automatically" works too. You don't need your own OAuth client. Click <strong>Add</strong>.</li>
  <li>Click <strong>Connect</strong>. A Context page opens and asks "Let Claude use your Context?". Check it shows the right email: if not, click <strong>Use another account</strong>. Then click <strong>Allow</strong>.</li>
</ol>
<p><strong>On a Team or Enterprise plan</strong>, an owner adds the connector first: <strong>Organization settings → Connectors → Add → Custom → Web</strong>, with the same address. Then each member goes to <strong>Customize → Connectors</strong> and clicks <strong>Connect</strong> to sign in with their own Context account.</p>
<p>In a chat, make sure Context is switched on: click the <strong>+</strong> button at the lower left of the message box, then <strong>Connectors</strong>. Then ask "What do you know about me from Context?"</p>
<p>Official guide: <a href="https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp">Get started with custom connectors using remote MCP</a>.</p>

<h2>ChatGPT</h2>
<p>ChatGPT supports custom MCP servers through <strong>Developer mode</strong>, a beta feature for paid plans on ChatGPT web. It's not on the Free plan. OpenAI has moved these menus several times, so your screen may differ from the steps below.</p>
<ol>
  <li>Open <a href="https://chatgpt.com">chatgpt.com</a> on the web and go to <strong>Settings</strong>.</li>
  <li>Open <strong>Apps</strong> (called <strong>Apps &amp; Connectors</strong> on some accounts).</li>
  <li>Scroll to <strong>Advanced settings</strong> and turn on <strong>Developer mode</strong>.</li>
  <li>Choose <strong>Create</strong> (some accounts show <strong>Add custom MCP server</strong> instead).</li>
  <li>Name it "Context" and paste <code>https://keepyourcontext.com/mcp</code> as the server URL.</li>
  <li>Set authentication to <strong>OAuth</strong>, accept the warning about custom servers, and click <strong>Create</strong>.</li>
  <li>A Context page opens. Click <strong>Allow</strong>.</li>
</ol>
<p>A few ChatGPT quirks:</p>
<ul>
  <li><strong>Turn it on in the chat.</strong> In a new chat, open the <strong>+</strong> menu and pick the connector, or name it in your message ("check Context for…").</li>
  <li><strong>Read vs write.</strong> OpenAI has at times limited some plans to read-only tools in Developer mode. If ChatGPT can read your memories but won't save new ones, check what your plan allows.</li>
  <li><strong>Business, Enterprise and Edu:</strong> admins control custom apps in workspace settings, and write actions may need an admin to switch them on.</li>
</ul>
<p>Menu names change often; check OpenAI's guide: <a href="https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt">Connecting custom MCP servers in ChatGPT</a>.</p>

<h2>Gemini</h2>
<p>You add a custom connector on the web, and once added it works in the mobile app too.</p>
<ol>
  <li>Go to <a href="https://gemini.google.com">gemini.google.com</a> on a computer.</li>
  <li>Click <strong>Customize</strong> on the left, then <strong>Connectors</strong> at the top. (<strong>Settings → Connected Apps</strong> takes you to the same page.)</li>
  <li>Next to the connectors search bar, click <strong>Custom</strong>.</li>
  <li>Paste <code>https://keepyourcontext.com/mcp</code>. Leave the client ID and client secret under <strong>Additional settings</strong> empty: Context doesn't need them.</li>
  <li>Click <strong>Next</strong>. Gemini shows a standard warning about custom connectors (it shows the same one for every server). Tick <strong>I understand and accept</strong> and continue.</li>
  <li>A Context page opens and asks "Let Gemini use your Context?". Check it shows the right email: if not, click <strong>Use another account</strong>. Then click <strong>Allow</strong>.</li>
</ol>
<p>To check it worked, start a new chat and ask "What do you know about me from Context?"</p>
<p>Google's help page lists these requirements. They may have changed since it was written:</p>
<ul>
  <li>You're <strong>18 or over and in the US</strong>.</li>
  <li>You're signed in with a <strong>personal Google Account</strong>. Work and school accounts can't do this.</li>
  <li><strong>Keep Activity</strong> is on.</li>
  <li>It's only available in <strong>English</strong>.</li>
</ul>
<p>Official guide: <a href="https://support.google.com/gemini/answer/17209137">Connect &amp; manage custom apps for Gemini Apps</a>.</p>

<h2>Grok</h2>
<ol>
  <li>Go to <a href="https://grok.com/connectors">grok.com/connectors</a>.</li>
  <li>Click <strong>New Connector</strong>, then <strong>Custom</strong>.</li>
  <li>Paste <code>https://keepyourcontext.com/mcp</code> and complete sign-in. When the Context page opens, click <strong>Allow</strong>.</li>
</ol>
<p>Custom connectors are a paid-plan feature in Grok, as far as we've seen. xAI's own page doesn't list which plans, so check there if the option is missing. On Grok Business and Enterprise, an admin may need to set connectors up first. Official guide: <a href="https://docs.x.ai/grok/connectors">Grok connectors</a>.</p>

<h2>After you connect: make the AI actually use it</h2>
<p>Adding a connector doesn't mean the AI will use it every time. Apps decide when to call a tool, and they often don't. Two things help a lot:</p>
<ol>
  <li><strong>Add a line to your custom instructions</strong> telling the AI when to use the connector. For Context, the Connect page gives you a ready-made paragraph to paste into Claude's profile settings and ChatGPT's <strong>Personalization → Custom instructions</strong>.</li>
  <li><strong>Ask for it by name</strong> the first few times: "Check Context, then plan my week."</li>
</ol>
<p>With Context, you can also say "Sync Context" at the end of a chat, and the AI saves anything new it learned about you.</p>

<h2>Troubleshooting</h2>
<h3>I don't see the option at all</h3>
<p>Usually it's the plan, the account type or the region. ChatGPT Free can't add custom servers. Gemini needs a personal account in the US. Check the vendor's help page for the current rules.</p>
<h3>It connected, but the AI never uses it</h3>
<p>Make sure the connector is switched on for that chat, then add the custom instructions above.</p>
<h3>The sign-in window closed or failed</h3>
<p>Remove the connector and add it again. Make sure pop-ups aren't blocked, and that you're signed in to the service (for Context, at keepyourcontext.com) in the same browser.</p>
<h3>How do I disconnect?</h3>
<p>Remove the connector in the app's settings. For Context, deleting your account also cuts off every connected app at once.</p>

<h2>Why bother?</h2>
<p>The most useful thing to plug in is often memory. Each AI app has its own memory now, but they don't share it. Connecting the same memory server to all of them means you tell one app something and the others know too. If you're switching apps, see <a href="/guides/transfer-chatgpt-memory-to-claude">How to transfer ChatGPT memory to Claude</a>. If you're comparing memory tools, see <a href="/guides/context-vs-openmemory-vs-supermemory">Context vs OpenMemory vs Supermemory</a>.</p>

<p>Ready to try it with a real server? <a href="https://keepyourcontext.com/login">Create a free Context account</a>, then follow the steps above with <code>https://keepyourcontext.com/mcp</code>. It takes a few minutes per app.</p>
`
};

export default article;
