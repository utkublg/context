// The Context mascot: a hermit crab, because it carries its home from shell to shell the way
// Context carries your memory from one AI to the next. Chalk-line body on the dark ground, with
// the shell as the one glowing thing. Animations live in public/site.css (.crab ...).

export type Mood = "idle" | "happy" | "curious" | "confused" | "sleeping" | "waving";

const INK = "#eee9e0";
const GROUND = "#131210";
const S = `stroke="${INK}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"`;
const EYES: [number, number][] = [
  [64, 72],
  [90, 70]
];
const PUPILS: Partial<Record<Mood, [number, number][]>> = {
  idle: [[3, -1], [3, -1]],
  curious: [[-2, -4], [-2, -4]],
  confused: [[-4, 2], [4, -3]],
  waving: [[2, 1], [2, 1]]
};

// Gradient ids must be unique on a page that shows several crabs.
let next = 0;

/** An inline SVG crab. With no label it's decorative and hidden from screen readers. */
export function crab(mood: Mood, label = ""): string {
  const id = `crab-shell-${next++}`;
  const eyeMarks =
    mood === "happy"
      ? EYES.map(([x, y]) => `<path d="M${x - 5} ${y + 2} q5 -7 10 0" fill="none" stroke="${GROUND}" stroke-width="3" stroke-linecap="round"/>`)
      : mood === "sleeping"
        ? EYES.map(([x, y]) => `<path d="M${x - 5} ${y} q5 5 10 0" fill="none" stroke="${GROUND}" stroke-width="3" stroke-linecap="round"/>`)
        : EYES.map(([x, y], i) => `<circle cx="${x + PUPILS[mood]![i][0]}" cy="${y + PUPILS[mood]![i][1]}" r="4" fill="${GROUND}"/>`);
  const mouth =
    {
      happy: `<path d="M70 121 q7 8 14 0" fill="none" ${S}/>`,
      curious: `<circle cx="77" cy="123" r="2.6" fill="none" stroke="${INK}" stroke-width="2.6"/>`,
      confused: `<path d="M70 124 q3 -4 6 0 t6 0" fill="none" ${S}/>`,
      sleeping: `<path d="M72 123 q4 2 8 0" fill="none" ${S}/>`
    }[mood as string] ?? `<path d="M71 122 q5 5 11 0" fill="none" ${S}/>`;
  const extra =
    {
      sleeping: `<g class="zz" font-family="Caveat, cursive" font-weight="700" fill="#f5b544"><text x="96" y="46" font-size="22">z</text><text x="110" y="30" font-size="16">z</text></g>`,
      confused: `<text x="104" y="48" font-family="Caveat, cursive" font-weight="700" font-size="34" fill="#f5b544">?</text>`,
      curious: `<path d="M100 44 l4 -8 M108 50 l8 -4 M96 40 l-1 -9" stroke="#f5b544" stroke-width="2.6" stroke-linecap="round"/>`
    }[mood as string] ?? "";
  const tilt = mood === "curious" ? -4 : mood === "sleeping" ? 6 : 0;
  const a11y = label ? `role="img" aria-label="${label}"` : `aria-hidden="true"`;
  return `<svg class="crab${mood === "waving" ? " waving" : ""}" viewBox="0 0 220 170" width="220" height="170" ${a11y}>
<defs><radialGradient id="${id}" cx="40%" cy="35%" r="75%"><stop offset="0" stop-color="#ffd98a"/><stop offset=".55" stop-color="#f5b544"/><stop offset="1" stop-color="#d9861f"/></radialGradient></defs>
<g class="bob">
<path d="M72 140 l-11 5 l-7 11 M86 142 l-4 10 l-9 8 M100 140 l5 9 l-3 11" fill="none" ${S}/>
<g class="shell-glow"><path d="M96 132 C84 104 92 72 120 60 L150 48 C168 40 186 32 206 20 C202 40 196 58 188 74 C202 92 200 120 178 132 C156 144 118 144 96 132 Z" fill="url(#${id})" stroke="${INK}" stroke-width="3.2" stroke-linejoin="round"/></g>
<path d="M150 48 C158 62 174 72 188 74 M172 37 C178 47 188 52 197 50 M120 60 C130 84 150 98 182 100 M106 122 C118 112 132 112 142 120" fill="none" stroke="#3a2608" stroke-width="3" stroke-linecap="round"/>
<path d="M106 132 C98 112 80 104 64 110 C51 116 49 133 60 139 C74 146 98 144 106 132 Z" fill="#1c1a17" ${S}/>
<g transform="rotate(${tilt} 78 106)">
<path d="M72 109 L65 81 M86 107 L90 79" fill="none" ${S}/>
<g class="eyes">${EYES.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9" fill="${INK}"/>`).join("")}${eyeMarks.join("")}</g>
</g>
${mouth}
<path d="M82 139 C78 146 72 149 66 147" fill="none" ${S}/><path d="M66 147 C58 150 53 143 57 138 C60 135 64 136 66 139 L61 142 Z" fill="#1c1a17" ${S}/>
<g${mood === "waving" ? ` transform="rotate(48 64 124)"` : ""}><g class="wave">
<path d="M64 126 C54 130 44 128 36 121" fill="none" ${S}/>
<path d="M36 121 C22 126 11 115 16 104 C20 96 31 95 37 101 L28 108 L39 110 C41 115 40 119 36 121 Z" fill="#1c1a17" ${S}/>
</g></g>
</g>
${extra}
</svg>`;
}

// The logo: the crab reduced to shell, eyes and one claw, with thicker lines so it still
// reads at favicon size. Drawn on a 64x64 grid; icon.ts puts it on a tile for app icons.
export const MARK_PATHS = (gradientId: string) => `
<defs><radialGradient id="${gradientId}" cx="40%" cy="35%" r="75%"><stop offset="0" stop-color="#ffd98a"/><stop offset=".55" stop-color="#f5b544"/><stop offset="1" stop-color="#d9861f"/></radialGradient></defs>
<path d="M16 54 l-3 5 M23 55 l1 5" fill="none" stroke="${INK}" stroke-width="2.8" stroke-linecap="round"/>
<path d="M25 51 C20 39 24 27 34 22 L43 18 C48 15 53 11 59 6 C58 13 56 19 54 24 C59 31 58 42 51 48 C45 54 33 55 25 51 Z" fill="url(#${gradientId})" stroke="${INK}" stroke-width="2.8" stroke-linejoin="round"/>
<path d="M43 18 C45 23 49 25 54 24 M31 25 C34 32 41 36 52 36" fill="none" stroke="#3a2608" stroke-width="2.6" stroke-linecap="round"/>
<path d="M28 51 C26 44 20 41 14 43 C9 45 9 52 13 55 C18 58 26 57 28 51 Z" fill="#1c1a17" stroke="${INK}" stroke-width="2.8" stroke-linejoin="round"/>
<path d="M15 44 L12 32 M22 43 L23 31" fill="none" stroke="${INK}" stroke-width="2.8" stroke-linecap="round"/>
<circle cx="11.5" cy="28.5" r="4.6" fill="${INK}"/><circle cx="23.5" cy="27.5" r="4.6" fill="${INK}"/>
<circle cx="13" cy="28.5" r="2" fill="${GROUND}"/><circle cx="25" cy="27.5" r="2" fill="${GROUND}"/>
<path d="M10 50 C5 52 2 48 4 44 C6 41 10 42 11 45 L7 46.5 Z" fill="#1c1a17" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>`;

/** The logo for the top bar. */
export const crabMark = () =>
  `<svg class="mark" viewBox="0 0 64 64" width="32" height="32" aria-hidden="true">${MARK_PATHS("mark-shell")}</svg>`;
