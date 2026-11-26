#!/bin/sh
# Deploys the committed code and records which commit it is, served at /version.
# Uncommitted changes would make /version lie about what's running, so they block the deploy.
set -e
if [ -n "$(git status --porcelain)" ]; then
  echo "Commit or stash your changes first: /version must match a real commit." >&2
  exit 1
fi
# /version links the commit on GitHub, so it should be pushed (CI deploys are always pushed).
if git remote get-url origin >/dev/null 2>&1 && [ -z "$(git branch -r --contains HEAD 2>/dev/null)" ]; then
  echo "Note: $(git rev-parse --short HEAD) isn't pushed yet, so its /version link won't open until you push." >&2
fi
npx wrangler deploy --var "GIT_COMMIT:$(git rev-parse HEAD)" "$@"
