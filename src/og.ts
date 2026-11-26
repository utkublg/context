// The link-preview card (og:image): the happy crab next to the headline, 1200x630.
// public/og.png is generated from this (see README); the Worker never serves the SVG itself.
import { crab } from "./crab";

export const OG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
<defs><radialGradient id="og-glow" cx="78%" cy="55%" r="45%"><stop offset="0" stop-color="#f5b544" stop-opacity=".18"/><stop offset="1" stop-color="#f5b544" stop-opacity="0"/></radialGradient></defs>
<rect width="1200" height="630" fill="#131210"/>
<rect width="1200" height="630" fill="url(#og-glow)"/>
<g font-family="Bricolage Grotesque" fill="#eee9e0">
<text x="80" y="128" font-size="44" font-weight="700" fill="#f5b544">Context</text>
<text x="80" y="268" font-size="84" font-weight="800">Stop telling</text>
<text x="80" y="362" font-size="84" font-weight="800">every AI who</text>
<text x="80" y="456" font-size="84" font-weight="800">you are.</text>
</g>
<text x="80" y="548" font-family="Figtree" font-size="32" fill="#a39c90">One memory for ChatGPT, Claude, Gemini and Grok.</text>
<g transform="translate(700 170) scale(2.1)">${crab("happy").replace(/<svg[^>]*>|<\/svg>/g, "")}</g>
</svg>`;
