#!/bin/bash
# Stop: перед завершением ответа — компиляция, стражи god-file / раздутых папок,
# наличие тестов на изменения, unit-тесты.
# Блокирует завершение через {"decision":"block"}, чтобы Claude починил сам.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

block() {
  node -e 'process.stdout.write(JSON.stringify({decision:"block",reason:process.argv[1]}))' "$1"
  exit 0
}

if ! out=$(npx --no-install tsc --noEmit --pretty false 2>&1); then
  block "Компиляция падает:
$out"
fi

# ── File-size guardrail over changed source files ──
# Forward-only: blocks completion if a change pushed any `src/**/*.{ts,tsx}`
# source file over the cap (a file already >cap on HEAD is a legacy god-file
# and is not this change's regression, so it is skipped). Reuses
# check-file-size.sh's own predicate; its non-zero exit (2) becomes a block().
MAX_SRC_LINES="${MAX_SRC_LINES:-600}"
if [ -f .claude/hooks/check-file-size.sh ]; then
  changed_big=()
  while IFS= read -r rel; do
    case "$rel" in *.ts|*.tsx) ;; *) continue ;; esac
    case "$rel" in src/*|*/src/*) ;; *) continue ;; esac
    if ! bash .claude/hooks/check-file-size.sh "$rel" >/dev/null 2>&1; then
      cur=$(wc -l < "$rel" | tr -d ' ')
      changed_big+=("$rel ($cur)")
    fi
  done < <(git diff --name-only --diff-filter=ACMR HEAD 2>/dev/null)
  if [ "${#changed_big[@]}" -gt 0 ]; then
    block "Изменённые файлы стали >${MAX_SRC_LINES} строк (разбей на модули): ${changed_big[*]}"
  fi
fi

# ── Folder file-count guardrail over changed files ──
# Strict, NOT forward-only: any changed file that lives in a folder holding more
# than MAX_FILES immediate files blocks completion. Reuses
# check-folder-file-count.sh's predicate. Includes untracked/new files so a
# burst of new files into one folder is caught too.
MAX_FILES="${FOLDER_MAX_FILES:-10}"
if [ -f .claude/hooks/check-folder-file-count.sh ]; then
  changed_folders=()
  while IFS= read -r rel; do
    case "$rel" in src/*|*/src/*) ;; *) continue ;; esac
    if ! bash .claude/hooks/check-folder-file-count.sh "$rel" >/dev/null 2>&1; then
      dir=$(dirname "$rel")
      cnt=$(find "$dir" -maxdepth 1 -type f -not -name '.*' 2>/dev/null | wc -l | tr -d ' ')
      changed_folders+=("$dir ($cnt)")
    fi
  done < <( { git diff --name-only --diff-filter=ACMR HEAD 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null; } | sort -u )
  if [ "${#changed_folders[@]}" -gt 0 ]; then
    block "Изменённые файлы находятся в папках с >${MAX_FILES} файлов (разбей на модули): ${changed_folders[*]}"
  fi
fi

if [ -f .claude/hooks/check-tests.mjs ]; then
  if ! out=$(node .claude/hooks/check-tests.mjs --changed 2>&1); then
    block "$out"
  fi
fi

# --passWithNoTests makes this safe to run unconditionally.
if ! out=$(npx --no-install vitest run 'src/**/*.unit.test.ts' --reporter=dot --passWithNoTests 2>&1); then
  block "Unit-тесты падают:
$out"
fi

exit 0
