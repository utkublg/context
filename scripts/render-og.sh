#!/usr/bin/env bash
# Renders public/og.png (the link-preview card) from src/og.ts with the site's own fonts.
# Needs rsvg-convert and woff2_decompress. The fonts are subset variable fonts whose internal
# family names differ from the CSS ones, so a throwaway fontconfig maps the CSS names to them.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

for f in bricolage-grotesque-latin figtree-latin; do
  cp "public/fonts/$f.woff2" "$tmp/" && woff2_decompress "$tmp/$f.woff2" >/dev/null && rm "$tmp/$f.woff2"
done
cat > "$tmp/fonts.conf" <<CONF
<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig>
<dir>$tmp</dir><include ignore_missing="yes">/etc/fonts/fonts.conf</include><cachedir>$tmp/cache</cachedir>
<alias binding="strong"><family>Bricolage Grotesque</family><prefer><family>Bricolage Grotesque 96pt ExtraBold</family></prefer></alias>
<alias binding="strong"><family>Figtree</family><prefer><family>Figtree Light</family></prefer></alias>
</fontconfig>
CONF

npx esbuild src/og.ts --bundle --format=esm --platform=node --log-level=warning --outfile="$tmp/og.mjs"
node -e "import('$tmp/og.mjs').then((m) => process.stdout.write(m.OG_SVG))" > "$tmp/og.svg"
FONTCONFIG_FILE="$tmp/fonts.conf" rsvg-convert -w 1200 -h 630 "$tmp/og.svg" -o public/og.png
echo "Wrote public/og.png"
