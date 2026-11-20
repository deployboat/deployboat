#!/usr/bin/env bash
# Make a Deploy Boat release.
#
#   ./release.sh 0.5.0
#
# Before running it, write what's new under "## 0.5.0" in CHANGELOG.md (plain words).
# Then this script:
#   1. checks everything is ready (on main, nothing uncommitted, up to date, notes written)
#   2. sets the version in VERSION and cli/package.json, and commits that
#   3. tags the commit v0.5.0 and pushes it
#   4. creates the GitHub Release with the notes from CHANGELOG.md, and attaches install.sh
#      (the short install command, deployboat.github.io/install.sh, downloads that copy)
#   5. publishes the CLI to npm, if you say yes
#
# Needs: git, gh (logged in: gh auth login), and npm (logged in: npm login) for step 5.
set -euo pipefail
cd "$(dirname "$0")"

VERSION="${1:-}"
VERSION="${VERSION#v}"   # accept 0.5.0 or v0.5.0
TAG="v$VERSION"

stop() { printf '\n  ✗ %s\n\n' "$*"; exit 1; }
say()  { printf '  %s\n' "$*"; }

# --- 1. checks -----------------------------------------------------------------------

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || stop "Usage: ./release.sh 0.5.0  (three numbers: major.minor.patch)"
command -v gh >/dev/null || stop "Install the GitHub CLI first: https://cli.github.com"
gh auth status >/dev/null 2>&1 || stop "Log in to GitHub first: gh auth login"
[ "$(git branch --show-current)" = main ] || stop "Switch to the main branch first."
[ -z "$(git status --porcelain)" ] || stop "Commit or stash your changes first (git status)."
git fetch -q origin main --tags
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || stop "Your main isn't the same as GitHub's. Pull or push first."
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && stop "$TAG already exists."

# The notes: everything between "## $VERSION" and the next "## " heading.
NOTES="$(awk -v v="## $VERSION" '$0 == v {on=1; next} /^## / {on=0} on' CHANGELOG.md)"
[ -n "$(echo "$NOTES" | tr -d '[:space:]')" ] || stop "Write the notes first: add a \"## $VERSION\" section to CHANGELOG.md."

LAST="$(git describe --tags --abbrev=0 2>/dev/null || echo none)"
say "Releasing $TAG (last release: $LAST). Notes:"
echo "$NOTES" | sed 's/^/    /'
read -r -p "  Go ahead? [y/N] " ok
[ "$ok" = y ] || stop "Stopped. Nothing changed."

# --- 2. version numbers ----------------------------------------------------------------

echo "$VERSION" > VERSION
(cd cli && npm version "$VERSION" --no-git-tag-version --allow-same-version >/dev/null)
git add VERSION cli/package.json
git diff --cached --quiet || git commit -q -m "Release $TAG"

# --- 3. tag and push ---------------------------------------------------------------------

git tag -a "$TAG" -m "Deploy Boat $TAG"
git push -q origin main "$TAG"
say "✓ Tagged and pushed $TAG"

# --- 4. GitHub Release ---------------------------------------------------------------------

echo "$NOTES" > "/tmp/deployboat-$TAG-notes.md"
gh release create "$TAG" install.sh --title "Deploy Boat $TAG" --notes-file "/tmp/deployboat-$TAG-notes.md" >/dev/null
rm -f "/tmp/deployboat-$TAG-notes.md"
say "✓ GitHub Release: https://github.com/deployboat/deployboat/releases/tag/$TAG"

# --- 5. npm ----------------------------------------------------------------------------------

read -r -p "  Publish the CLI to npm as deployboat@$VERSION? [y/N] " ok
if [ "$ok" = y ]; then
  (cd cli && npm publish)
  say "✓ Published deployboat@$VERSION on npm"
else
  say "Skipped npm. Later: cd cli && npm publish"
fi

say ""
say "Done. Servers see the update in Server Doctor within an hour."
