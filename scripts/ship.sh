#!/usr/bin/env bash
# Ships the current work to main and does not return until the deploy pipeline has resolved.
#
#   scripts/ship.sh -m "fix: something"     commit everything pending, then ship
#   scripts/ship.sh                         ship what is already committed
#   scripts/ship.sh --help
#
# Steps: commit (-m) -> fetch + rebase on origin/main -> typecheck, tests, build -> push HEAD to main (retried)
#        -> find the pipeline run for the pushed commit -> wait for it -> clean up the working branch.
# Exit codes: 0 pipeline succeeded, 1 a step failed (checks, rebase conflict, push, pipeline), 2 usage / no run found.
# Safe to re-run: with nothing new to push it just watches the pipeline of the current main commit.
set -euo pipefail

MESSAGE=""
CHECKS=1
E2E=0
CLEANUP=1
TIMEOUT=900   # seconds to wait for the pipeline
RUN_WAIT=120  # seconds to wait for the run to appear after the push

usage() { sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; cat <<'EOF'

Options:
  -m, --message TEXT   commit all pending changes first (single line: AGENTS.md forbids bodies and trailers)
      --skip-checks    do not run typecheck / tests / build
      --e2e            also run the Playwright suite (slow)
      --keep-branch    do not delete the working branch afterwards
      --timeout SECS   max wait for the pipeline (default 900)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--message) MESSAGE="${2:?missing commit message}"; shift 2 ;;
    --skip-checks) CHECKS=0; shift ;;
    --e2e) E2E=1; shift ;;
    --keep-branch) CLEANUP=0; shift ;;
    --timeout) TIMEOUT="${2:?missing seconds}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

say() { printf '\n== %s\n' "$*"; }
die() { printf 'ship: %s\n' "$*" >&2; exit 1; }

command -v gh >/dev/null || die "gh CLI is required to follow the pipeline"
cd "$(git rev-parse --show-toplevel)"

REMOTE_URL=$(git remote get-url origin)
REPO=$(printf '%s' "$REMOTE_URL" | sed -E 's#(\.git)?$##; s#^.*[:/]([^/:]+/[^/]+)$#\1#')
BRANCH=$(git branch --show-current)
[[ -n "$BRANCH" ]] || die "detached HEAD: check out a branch first"

# ---- 1. commit ----
if [[ -n "$(git status --porcelain)" ]]; then
  [[ -n "$MESSAGE" ]] || die "uncommitted changes: commit them or pass -m \"one-line message\""
  [[ "$MESSAGE" != *$'\n'* ]] || die "the commit message must be a single line"
  say "Committing: $MESSAGE"
  git add -A
  git commit -q -m "$MESSAGE"
elif [[ -n "$MESSAGE" ]]; then
  echo "(nothing to commit, ignoring -m)"
fi

# ---- 2. rebase on main (shallow-clone friendly) ----
say "Rebasing on origin/main"
git fetch -q --depth=200 origin main
if ! git rebase FETCH_HEAD >/dev/null 2>&1; then
  git rebase --abort >/dev/null 2>&1 || true
  die "rebase on origin/main conflicts: resolve it by hand (git fetch origin main && git rebase FETCH_HEAD), then re-run"
fi
MAIN_SHA=$(git rev-parse FETCH_HEAD)
HEAD_SHA=$(git rev-parse HEAD)

# ---- 3. checks (after the rebase: they must pass on what actually ships) ----
if [[ "$HEAD_SHA" != "$MAIN_SHA" && "$CHECKS" == 1 ]]; then
  say "Typecheck, tests, build"
  npm run typecheck && npm test && npm run build || die "checks failed: nothing was pushed"
  if [[ "$E2E" == 1 ]]; then say "E2E"; npm run e2e || die "e2e failed: nothing was pushed"; fi
fi

# ---- 4. push (retried: the proxy can drop a connection) ----
if [[ "$HEAD_SHA" == "$MAIN_SHA" ]]; then
  say "Nothing new to push: following the pipeline of main (${HEAD_SHA:0:7})"
else
  say "Pushing ${HEAD_SHA:0:7} to main"
  pushed=0
  for attempt in 1 2 3; do
    if git push origin HEAD:main; then pushed=1; break; fi
    echo "push attempt $attempt failed, retrying..." >&2
    sleep $((attempt * 5))
    # main may have moved meanwhile: rebase again instead of failing on a non-fast-forward
    git fetch -q --depth=200 origin main && git rebase FETCH_HEAD >/dev/null 2>&1 || { git rebase --abort >/dev/null 2>&1 || true; die "rebase conflict while retrying the push"; }
    HEAD_SHA=$(git rev-parse HEAD)
  done
  [[ "$pushed" == 1 ]] || die "push to main failed 3 times"
fi

# ---- 5. follow the pipeline ----
say "Looking for the pipeline run of ${HEAD_SHA:0:7}"
RUN_ID=""
deadline=$((SECONDS + RUN_WAIT))
while [[ -z "$RUN_ID" && $SECONDS -lt $deadline ]]; do
  RUN_ID=$(gh run list --repo "$REPO" --branch main --commit "$HEAD_SHA" --limit 1 --json databaseId --jq '.[0].databaseId // empty' 2>/dev/null || true)
  [[ -n "$RUN_ID" ]] || sleep 5
done
[[ -n "$RUN_ID" ]] || { echo "ship: no pipeline run appeared for ${HEAD_SHA:0:7} within ${RUN_WAIT}s" >&2; exit 2; }
echo "https://github.com/$REPO/actions/runs/$RUN_ID"

deadline=$((SECONDS + TIMEOUT))
CONCLUSION=""
while [[ $SECONDS -lt $deadline ]]; do
  STATUS=$(gh run view "$RUN_ID" --repo "$REPO" --json status,conclusion --jq '.status + " " + (.conclusion // "")' 2>/dev/null || echo "unknown ")
  if [[ "${STATUS%% *}" == "completed" ]]; then CONCLUSION="${STATUS#* }"; break; fi
  sleep 10
done
[[ -n "$CONCLUSION" ]] || die "pipeline still running after ${TIMEOUT}s: https://github.com/$REPO/actions/runs/$RUN_ID"
if [[ "$CONCLUSION" != "success" ]]; then
  gh run view "$RUN_ID" --repo "$REPO" --log-failed 2>/dev/null | tail -60 || true
  die "pipeline $CONCLUSION: https://github.com/$REPO/actions/runs/$RUN_ID (fix it and re-run ship.sh)"
fi

# ---- 6. clean up: main is the only branch that stays ----
if [[ "$BRANCH" != "main" && "$CLEANUP" == 1 ]]; then
  say "Deleting working branch $BRANCH"
  git checkout -q main 2>/dev/null || git checkout -q -b main FETCH_HEAD
  git reset -q --hard "$HEAD_SHA"
  git branch -D "$BRANCH" >/dev/null 2>&1 || true
  if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
    git push -q origin --delete "$BRANCH" 2>/dev/null || echo "warning: could not delete origin/$BRANCH (the git proxy may forbid it): delete it by hand" >&2
  fi
fi

say "Shipped ${HEAD_SHA:0:7}: pipeline succeeded (https://github.com/$REPO/actions/runs/$RUN_ID)"
