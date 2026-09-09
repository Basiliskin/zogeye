#!/bin/bash
# Folder file-count guardrail: block touching any source folder that holds more
# than MAX_FILES immediate files (immediate children — not recursive). This
# enforces a hard "max N files per folder" cap on the maintainable source
# trees, so a bloated folder must be split instead of grown. Counts EVERY
# regular file in the parent directory, including tests and config files;
# directories and hidden files are not counted (a directory's subfolders are
# judged on their own).
#
# Strict, NOT forward-only: a folder already over the cap blocks any write into
# it — the split is required now, not deferred.
#
# Wired two ways (mirrors check-file-size.sh):
#   - PostToolUse on Edit|Write — receives the changed file path via the hook
#     stdin JSON payload (`tool_input.file_path`), like lint-changed.sh.
#   - stop-verify.sh sweep — a `git diff HEAD` loop calls the same predicate
#     per changed file (via `$1`), block()ing through the Stop JSON decision.
#
# Scope: only files under a src/ tree (`src/*` or `*/src/*`). Defensively skips
# node_modules / .git. MAX_FILES is overridable with FOLDER_MAX_FILES.
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
# Relativize an absolute path so the directory-relative find works from repo root.
case "$file" in /*) file="${file#"$PWD"/}" ;; esac
[ -f "$file" ] || exit 0

# Narrow to a src/ tree, and defensively skip vendored/ignored trees.
case "$file" in src/*|*/src/*) ;; *) exit 0 ;; esac
case "$file" in */node_modules/*|*/.git/*) exit 0 ;; esac
# Mapper-generated CLAUDE.md is documentation, not a source module: a CLAUDE.md
# change neither triggers the module split nor should its presence in a folder
# count toward that folder's module total.
case "$(basename "$file")" in CLAUDE.md) exit 0 ;; esac

MAX_FILES="${FOLDER_MAX_FILES:-10}"
dir=$(dirname "$file")
# Immediate regular files (exclude hidden junk like .DS_Store, and mapper
# CLAUDE.md docs so their presence doesn't inflate a folder's module count);
# subdirectories are judged on their own, so `-type f` at maxdepth 1 is the
# correct measure.
count=$(find "$dir" -maxdepth 1 -type f -not -name '.*' -not -name 'CLAUDE.md' 2>/dev/null | wc -l | tr -d ' ')
[ "$count" -le "$MAX_FILES" ] && exit 0

echo "check-folder-file-count: $dir has $count files (> $MAX_FILES) — split it into modules." >&2
exit 2
