// The Context icon: the hermit crab logo on a dark tile, used as the favicon and for app
// directory listings. PNG copies are generated from this in branding/ (see README).
import { MARK_PATHS } from "./crab";

export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
<rect width="64" height="64" rx="14" fill="#131210"/>
<g transform="translate(5 5) scale(.84)">${MARK_PATHS("icon-shell")}</g>
</svg>`;
