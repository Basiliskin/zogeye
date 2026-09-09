#!/usr/bin/env bash
# Block dead-code commitment.
#
# Запускает три детерминированные проверки перед коммитом:
#   1. `tsc --noEmit` со strict-флагами, чтобы поймать unused locals/params
#      в staged-файлах (и во всём проекте — компилятор не умеет фильтровать
#      по файлам).
#   2. `eslint . --max-warnings 0` — то же самое, через type-aware линтер.
#      Дублирует первый шаг намеренно: tsc ловит по типам, eslint — по
#      scope-анализу, и на стыке они покрывают больше случаев.
#   3. `node .claude/hooks/check-dead-exports.mjs --staged` — для каждого
#      staged .ts-файла проверяет, что каждый экспорт импортируется хотя бы
#      в одном другом файле. Это ловит «написали, но никто не позвал».
#
#   ./scripts/block-dead-code.sh                — staged файлы (pre-commit)
#   ./scripts/block-dead-code.sh --all          — весь src/
#   ./scripts/block-dead-code.sh --files a.ts   — точечный прогон
#
# Коды выхода: 0 — clean, ≥1 — есть проблемы (скрипт останавливается на
# первой красной ступени).

set -uo pipefail

BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; DIM=$'\033[2m'; OFF=$'\033[0m'
[ -t 1 ] || { BOLD=''; RED=''; GREEN=''; DIM=''; OFF=''; }

MODE="staged"
EXTRA_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --all) MODE="all" ;;
    --files) MODE="files"; shift; EXTRA_ARGS=("$@"); break ;;
    --help|-h)
      sed -n '2,15p' "$0"
      exit 0
      ;;
    *) echo "неизвестный флаг: $1" >&2; exit 1 ;;
  esac
  shift
done

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT" || { echo "не удалось перейти в $ROOT" >&2; exit 1; }

DEAD_SCRIPT=".claude/hooks/check-dead-exports.mjs"
[ -f "$DEAD_SCRIPT" ] || { echo "не найден $DEAD_SCRIPT" >&2; exit 1; }

run() {
  local name="$1"; shift
  printf '%s[dead-code] %s%s\n' "$BOLD" "$name" "$OFF"
  local start rc
  start=$(date +%s)
  if out=$("$@" 2>&1); then
    rc=0
    printf '  %s✓%s %s(%ss)%s\n' "$GREEN" "$OFF" "$DIM" "$(( $(date +%s) - start ))" "$OFF"
  else
    rc=$?
    printf '  %s✗ провалено%s (код %d)\n\n%s\n' "$RED" "$OFF" "$rc" "$out"
  fi
  return $rc
}

# Stage 1 — tsc.
run "TypeScript: no-unused strict" npx --no-install tsc --noEmit --pretty false || exit 1

# Stage 2 — eslint (catches what tsc misses).
run "ESLint: no-unused strict" npx --no-install eslint . --max-warnings 0 || exit 1

# Stage 3 — exported-symbol dead-export scan.
case "$MODE" in
  all)
    run "Dead exports: full src/" node "$DEAD_SCRIPT" --all || exit 1 ;;
  files)
    run "Dead exports: explicit files" node "$DEAD_SCRIPT" --files "${EXTRA_ARGS[@]}" || exit 1 ;;
  staged)
    if git rev-parse --git-dir >/dev/null 2>&1; then
      run "Dead exports: staged files" node "$DEAD_SCRIPT" --staged || exit 1
    else
      printf '%s[dead-code] не git-репозиторий — пропускаю staged-проверку%s\n' "$DIM" "$OFF"
    fi
    ;;
esac

printf '\n%s%sDead-code gate clean%s\n' "$BOLD" "$GREEN" "$OFF"
