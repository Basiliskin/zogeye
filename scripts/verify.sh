#!/usr/bin/env bash
# Прогон quality pipeline. Ступени идут по возрастанию цены, останавливаемся на первой красной.
#   ./scripts/verify.sh            все ступени
#   ./scripts/verify.sh --fast     только 1-4 (то, что уместно в pre-commit)
#   ./scripts/verify.sh --from 5   начать с указанной ступени
#   ./scripts/verify.sh --list
set -uo pipefail

BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; DIM=$'\033[2m'; OFF=$'\033[0m'
[ -t 1 ] || { BOLD=''; RED=''; GREEN=''; DIM=''; OFF=''; }

if [ -f pnpm-lock.yaml ]; then AUDIT_CMD="pnpm audit --audit-level=high"
elif [ -f yarn.lock ]; then AUDIT_CMD="yarn audit --level high"
else AUDIT_CMD="npm audit --audit-level=high"
fi

STAGES=(
  "TypeScript compile|npx tsc --noEmit --pretty false"
  "ESLint|npx eslint . --max-warnings 0"
  "Tests: coverage guard|node .claude/hooks/check-tests.mjs --changed"
  "Dead-code gate|./scripts/block-dead-code.sh --all"
  "Unit tests|npx vitest run 'src/**/*.unit.test.ts' --passWithNoTests"
  "Integration tests|npx vitest run 'src/**/*.int.test.ts' --fileParallelism=false --passWithNoTests"
  "E2E|npx vitest run 'src/**/*.e2e.test.ts' --passWithNoTests"
  "Security: deps|$AUDIT_CMD"
  # gitleaks isn't an npm package; skip gracefully when it's not on PATH
  # instead of hard-failing the pipeline until it's installed.
  "Security: secrets|command -v gitleaks >/dev/null 2>&1 && gitleaks detect --no-banner --redact || echo 'gitleaks not installed — skipped'"
  "Framework rules|node .claude/hooks/framework-rules.mjs"
  "Dependency architecture|npx --no-install dependency-cruiser --validate .dependency-cruiser.mjs src"
)

FROM=1; TO=${#STAGES[@]}
while [ $# -gt 0 ]; do
  case "$1" in
    --fast) TO=5 ;;
    --from) FROM=$2; shift ;;
    --list) i=1; for s in "${STAGES[@]}"; do echo "$i. ${s%%|*}"; i=$((i+1)); done; exit 0 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "неизвестный флаг: $1" >&2; exit 1 ;;
  esac
  shift
done

failed=0
i=0
for entry in "${STAGES[@]}"; do
  i=$((i+1))
  [ "$i" -lt "$FROM" ] && continue
  [ "$i" -gt "$TO" ] && continue
  name="${entry%%|*}"; cmd="${entry#*|}"
  printf '%s[%d/%d] %s%s\n' "$BOLD" "$i" "${#STAGES[@]}" "$name" "$OFF"
  start=$(date +%s)
  if out=$(eval "$cmd" 2>&1); then
    printf '  %s✓%s %s(%ss)%s\n' "$GREEN" "$OFF" "$DIM" "$(( $(date +%s) - start ))" "$OFF"
  else
    printf '  %s✗ провалено%s\n\n%s\n\n' "$RED" "$OFF" "$out"
    printf '%sОстановлено на ступени %d — почини и запусти: ./scripts/verify.sh --from %d%s\n' "$BOLD" "$i" "$i" "$OFF"
    failed=1
    break
  fi
done

[ "$failed" -eq 0 ] && printf '\n%s%sВсе ступени пройдены%s\n' "$BOLD" "$GREEN" "$OFF"
exit $failed
