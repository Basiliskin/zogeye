#!/bin/bash
# PostToolUse: prettier + eslint по одному изменённому файлу. Должен быть быстрым.
set -uo pipefail
input=$(cat)
file=$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).tool_input?.file_path??"")}catch{}})')
[ -z "$file" ] && exit 0
[ -f "$file" ] || exit 0
case "$file" in *.ts|*.tsx) ;; *) exit 0 ;; esac

# Negative lint fixtures are excluded from the green ESLint run (top-level
# `ignores`) and are only ever linted by the dedicated `lint:*-fixture`
# scripts with `--no-ignore`, so a plain `eslint` run on one always reports
# "File ignored" and would spuriously block every edit to them.
case "$file" in */__lint-fixtures__/*) exit 0 ;; esac

# Config files (`*.config.*`) are likewise excluded from the green ESLint run
# by the top-level `ignores` — they are infra, not linted source. A plain
# `eslint` run on one reports "File ignored" as a warning, which
# `--max-warnings 0` turns into a failure, spuriously blocking every edit to
# them (vite/vitest/eslint configs). Skip them for the same reason as the
# fixtures above.
case "$file" in *.config.*) exit 0 ;; esac

npx --no-install prettier --write "$file" >/dev/null 2>&1

if out=$(npx --no-install eslint "$file" --max-warnings 0 2>&1); then
  exit 0
fi
echo "ESLint: проблемы в $file" >&2
echo "$out" >&2
exit 2
