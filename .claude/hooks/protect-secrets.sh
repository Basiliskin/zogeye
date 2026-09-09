#!/bin/bash
# PreToolUse: запрет чтения и правки файлов с секретами.
set -uo pipefail
input=$(cat)
file=$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).tool_input?.file_path??"")}catch{}})')
case "$file" in
  *.env|*.env.*|*id_rsa*|*id_ed25519*|*.pem|*.p12|*credentials*|*secrets.json)
    cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Доступ к файлам с секретами запрещён хуком проекта"}}
JSON
    exit 0 ;;
esac
exit 0
