#!/bin/bash
# File-size guardrail: block a source file that this change pushed over the
# per-file cap (MAX_SRC_LINES). Keeps god-files from creeping back after a
# split.
#
# Wired two ways:
#   - PostToolUse on Edit|Write — receives the changed file path via the hook
#     stdin JSON payload (`tool_input.file_path`), like lint-changed.sh.
#   - stop-verify.sh sweep — a `git diff HEAD` loop calls the same predicate
#     per changed source file (via `$1`), block()ing via the Stop JSON decision.
#
# Scope: only `src/**/*.{ts,tsx}` source, excluding test files, `*.d.ts`,
# `*.config.*`, `__lint-fixtures__` and `prompts.ts` (test/config/prompt files
# are allowed to be long; the cap targets maintainable source).
#
# Forward-only predicate: a file that was ALREADY over the cap on HEAD is a
# legacy god-file, not this change's regression, so editing it is not blocked
# (the cap is enforced from the next time it drops back under, or for NEW
# files that exceed it). Only "grew past the cap" or "new > cap" blocks.
#
# Override the cap with MAX_SRC_LINES in the environment.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# Path source: explicit arg (Stop sweep) or stdin JSON (PostToolUse).
if [ "$#" -ge 1 ]; then
  file="$1"
else
  input=$(cat)
  file=$(printf '%s' "$input" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      try{process.stdout.write(JSON.parse(s).tool_input?.file_path??"")}catch{}
    })')
fi
[ -z "$file" ] && exit 0
# Relativize an absolute path so `git show HEAD:$file` works from the repo root.
case "$file" in /*) file="${file#"$PWD"/}" ;; esac
[ -f "$file" ] || exit 0

# Narrow to source .ts/.tsx under a src/ tree.
case "$file" in *.ts|*.tsx) ;; *) exit 0 ;; esac
case "$file" in src/*|*/src/*) ;; *) exit 0 ;; esac
case "$file" in *.d.ts|*.config.*) exit 0 ;; esac
case "$file" in *.unit.test.ts|*.int.test.ts|*.e2e.test.ts|*.spec.ts) exit 0 ;; esac
case "$file" in */__lint-fixtures__/*) exit 0 ;; esac
case "$file" in */prompts.ts) exit 0 ;; esac

MAX_SRC_LINES="${MAX_SRC_LINES:-600}"
current=$(wc -l < "$file" | tr -d ' ')
[ "$current" -le "$MAX_SRC_LINES" ] && exit 0

# HEAD line count; untracked/new → treated as 0 → blocked.
head_lines=0
if head_src=$(git show "HEAD:$file" 2>/dev/null); then
  head_lines=$(printf '%s' "$head_src" | wc -l | tr -d ' ')
fi
# If HEAD was already over the cap, this is a legacy file — skip.
[ "$head_lines" -le "$MAX_SRC_LINES" ] || exit 0

echo "check-file-size: $file is now $current lines (> $MAX_SRC_LINES) — split it into modules." >&2
exit 2
