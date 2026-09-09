#!/usr/bin/env bash
# Idempotent installer for the git pre-commit / pre-push quality hooks.
#
#   ./scripts/install-hooks.sh          установить (или обновить)
#   ./scripts/install-hooks.sh --uninstall   снять (вернуть core.hooksPath
#                                              к дефолту .git/hooks)
#
# Скрипт не редактирует .git/hooks напрямую — он переключает
# `core.hooksPath` на каталог .githooks/ в репозитории, поэтому хуки
# попадают в индекс и едут вместе с кодом.

set -uo pipefail

BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; OFF=$'\033[0m'
[ -t 1 ] || { BOLD=''; GREEN=''; YELLOW=''; OFF=''; }

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT" || { echo "не удалось перейти в $ROOT" >&2; exit 1; }

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "install-hooks: это не git-репозиторий" >&2
  exit 1
fi

HOOKS_DIR=".githooks"
PRE_COMMIT="$HOOKS_DIR/pre-commit"

uninstall=0
case "${1:-}" in
  --uninstall|-u) uninstall=1 ;;
  --help|-h)
    sed -n '2,12p' "$0"
    exit 0
    ;;
esac

if [ "$uninstall" -eq 1 ]; then
  git config --unset core.hooksPath
  printf '%s✓ core.hooksPath сброшен — будут использоваться .git/hooks/%s\n' "$GREEN" "$OFF"
  exit 0
fi

if [ ! -f "$PRE_COMMIT" ]; then
  echo "install-hooks: не найден $PRE_COMMIT" >&2
  exit 1
fi

chmod +x "$HOOKS_DIR"/* 2>/dev/null || chmod +x "$PRE_COMMIT"
git config core.hooksPath "$HOOKS_DIR"

CURRENT=$(git config --get core.hooksPath || true)
if [ "$CURRENT" = "$HOOKS_DIR" ]; then
  printf '%s✓ хуки установлены: %s/* (core.hooksPath=%s)%s\n' \
    "$GREEN" "$HOOKS_DIR" "$CURRENT" "$OFF"
else
  printf '%s! core.hooksPath=%s, ожидалось %s%s\n' "$YELLOW" "$CURRENT" "$HOOKS_DIR" "$OFF" >&2
  exit 1
fi
