#!/usr/bin/env bash
# Publishes the e2e screenshots to the e2e-screenshots branch and keeps one
# comment on the pull request up to date with them and the run summary.
#
#   PR=<number> SHA=<head sha> SHOTS=<dir> SUMMARY=<summary.md> GH_TOKEN=... scripts/e2e-pr-comment.sh
#
# Images in a comment must have a public URL; raw.githubusercontent.com serves
# that branch, so the pictures live in git, one directory per pull request,
# overwritten on every run.
set -euo pipefail
: "${PR:?}" "${SHA:?}" "${SHOTS:?}" "${SUMMARY:?}" "${GITHUB_REPOSITORY:?}" "${GH_TOKEN:?}"

branch=e2e-screenshots
work=$(mktemp -d)
git init -q "$work"
git -C "$work" remote add origin "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
if git -C "$work" fetch -q --depth 1 origin "$branch" 2>/dev/null; then
  git -C "$work" checkout -q -b "$branch" FETCH_HEAD
else
  git -C "$work" checkout -q --orphan "$branch"
fi
rm -rf "$work/pr-$PR"
mkdir -p "$work/pr-$PR"
cp "$SHOTS"/*.png "$work/pr-$PR/" 2>/dev/null || true
git -C "$work" add -A
if ! git -C "$work" diff --cached --quiet; then
  git -C "$work" -c user.name=github-actions -c user.email=github-actions@github.com \
    commit -qm "pr #$PR @ ${SHA:0:7}"
  git -C "$work" push -q origin "$branch"
fi

marker="<!-- tabbrew-e2e-chrome -->"
body=$(mktemp)
{
  echo "$marker"
  cat "$SUMMARY"
  echo
  echo "<details open><summary>Screenshots at ${SHA:0:7}</summary>"
  echo
  for file in "$work/pr-$PR"/*.png; do
    [ -e "$file" ] || continue
    name=$(basename "$file")
    # The path is reused across runs; the sha keeps GitHub's image cache from serving the old picture.
    echo "**$name**"
    echo
    echo "![$name](https://raw.githubusercontent.com/${GITHUB_REPOSITORY}/${branch}/pr-${PR}/${name}?${SHA:0:7})"
    echo
  done
  echo "</details>"
} >"$body"

existing=$(gh api "repos/${GITHUB_REPOSITORY}/issues/${PR}/comments" --paginate \
  --jq "map(select(.body | startswith(\"$marker\"))) | .[0].id // empty")
if [ -n "$existing" ]; then
  gh api -X PATCH "repos/${GITHUB_REPOSITORY}/issues/comments/${existing}" -F body=@"$body" >/dev/null
else
  gh api -X POST "repos/${GITHUB_REPOSITORY}/issues/${PR}/comments" -F body=@"$body" >/dev/null
fi
echo "commented on #$PR"
