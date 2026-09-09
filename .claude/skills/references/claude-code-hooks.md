# Claude Code hooks — справочник

Оглавление: [Где живут](#где-живут) · [Схема](#схема-конфига) · [События](#события) · [Матчеры и if](#матчеры-и-if) · [Коды выхода](#коды-выхода) · [JSON-вывод](#json-вывод) · [Готовые хуки под pipeline](#готовые-хуки-под-pipeline) · [Диагностика](#диагностика)

Официальная документация: https://code.claude.com/docs/en/hooks

## Где живут

| Файл | Область | Коммитится |
|---|---|---|
| `~/.claude/settings.json` | все проекты пользователя | нет |
| `.claude/settings.json` | проект | да — так хуки получает вся команда |
| `.claude/settings.local.json` | проект, локально | нет (в .gitignore) |
| `hooks/hooks.json` в плагине | пока плагин включён | с плагином |
| frontmatter скилла/сабагента | пока компонент активен | с компонентом |

Хуки из разных уровней **складываются**, а не перезаписывают друг друга. `"disableAllHooks": true` временно выключает всё; отключить один хук нельзя — только удалить его запись.

Скиллы могут объявлять свои хуки прямо во frontmatter — удобно, когда проверка нужна только на время работы конкретного скилла:

```yaml
---
name: secure-operations
description: ...
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/security-check.sh"
---
```

## Схема конфига

Три уровня вложенности: событие → группа матчера → обработчики.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "if": "Edit(**/*.ts)",
            "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/lint-changed.sh",
            "args": [],
            "timeout": 30,
            "statusMessage": "Линтую изменённый файл..."
          }
        ]
      }
    ]
  }
}
```

Типы обработчиков: `command` (shell), `http` (POST на URL), `mcp_tool`, `prompt` (одноходовая оценка моделью), `agent` (экспериментальный). Для наших задач нужен `command`.

**Exec-форма vs shell-форма.** Есть `args` → `command` запускается напрямую как исполняемый файл, без шелла: каждый элемент `args` передаётся как один аргумент, кавычки не нужны. Нет `args` → строка уходит в шелл, доступны пайпы и `&&`. Если в команде есть плейсхолдер пути — используй exec-форму, иначе путь с пробелом сломает хук.

Плейсхолдеры: `${CLAUDE_PROJECT_DIR}` (корень проекта), `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`.

Полезные поля обработчика: `timeout` (сек), `async: true` (не блокировать), `asyncRewake: true` (разбудить Claude при exit 2 из фоновой задачи), `once: true` (только во frontmatter скилла), `shell: "bash" | "powershell"`.

## События

Наиболее полезные для контроля качества:

| Событие | Когда | Может блокировать |
|---|---|---|
| `SessionStart` | старт/возобновление сессии | нет; stdout уходит в контекст |
| `UserPromptSubmit` | перед обработкой промпта | да (таймаут по умолчанию 30с) |
| `PreToolUse` | перед вызовом инструмента | да |
| `PostToolUse` | после успешного вызова | нет (инструмент уже отработал), но stderr виден Claude |
| `PostToolUseFailure` | после неудачного вызова | нет |
| `Stop` | Claude закончил отвечать | да — разговор продолжится |
| `SubagentStop` | сабагент закончил | да |
| `SessionEnd` | конец сессии | нет |

Всего событий около трёх десятков (`PreCompact`, `FileChanged`, `ConfigChange`, `Notification`, `TaskCompleted` и др.) — полный список в документации.

Хуки из settings и плагинов работают и внутри сабагентов; во входном JSON тогда есть `agent_id` и `agent_type`.

## Матчеры и if

Матчер фильтрует по **имени инструмента** (`tool_name`), не по тексту промпта.

| Значение | Как трактуется |
|---|---|
| `"*"`, `""`, отсутствует | всё |
| только буквы/цифры/`_`/`-`/пробелы/`,`/`\|` | точное совпадение или список через `\|` / `,` |
| любой другой символ | JS-регулярка без якорей |

`Edit.*` матчит и `NotebookEdit` — если нужно строгое совпадение, пиши `^Edit$`. MCP-инструменты: `mcp__memory__.*` (точка со звёздочкой обязательны).

Поле `if` фильтрует точнее — по имени инструмента вместе с аргументами, синтаксисом permission-правил:

- `"Edit(**/*.ts)"` — только TypeScript-файлы
- `"Bash(git commit *)"` — только команды коммита
- `"Edit(**/src/**)"` — директория `src` на любой глубине (`"Edit(src/**)"` — только в корне)

`if` содержит ровно одно правило, `&&`/`||` не поддерживаются — нужны несколько условий, объяви несколько обработчиков. Работает только на событиях инструментов; фильтр best-effort и при непарсящейся команде срабатывает открыто, поэтому жёсткие запреты делай через permissions, а не хуком.

## Коды выхода

| Код | Значение |
|---|---|
| 0 | успех; stdout парсится как JSON-решение |
| 2 | блокирующая ошибка; stdout игнорируется, **stderr уходит Claude как сообщение об ошибке** |
| любой другой | неблокирующая ошибка; выполнение продолжается |

**Код 1 не блокирует.** Это главная ловушка: привычный unix-овый `exit 1` превращает защитный хук в декорацию. Для запрета — только `exit 2`.

## JSON-вывод

Альтернатива кодам возврата: выйти с 0 и напечатать JSON в stdout. Смешивать нельзя — JSON читается только при коде 0.

Универсальные поля: `continue: false` + `stopReason` (остановить Claude полностью), `suppressOutput`, `systemMessage`, `terminalSequence`.

PreToolUse — своя схема решений:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Файлы .env читать нельзя"
  }
}
```

`permissionDecision`: `allow` / `deny` / `ask` / `defer`. Молчание (exit 0 без вывода) — это не одобрение, а отсутствие решения: дальше работает обычный permission-флоу.

PostToolUse, UserPromptSubmit, Stop и др. — верхнеуровневое решение:

```json
{ "decision": "block", "reason": "Тесты не проходят, почини перед завершением" }
```

Передать информацию в контекст Claude: `hookSpecificOutput.additionalContext`. Пиши там факты («в проекте используется bun test»), а не команды в императиве — текст, похожий на системную инструкцию, срабатывает как подозрение на prompt injection. Статичные соглашения лучше держать в CLAUDE.md, а не гонять скриптом.

Лимит на строки вывода — 10 000 символов.

## Готовые хуки под pipeline

`.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "if": "Edit(**/*.ts)",
            "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/lint-changed.sh", "args": [],
            "timeout": 30, "statusMessage": "prettier + eslint" }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Read|Edit|Write",
        "hooks": [
          { "type": "command",
            "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/protect-secrets.sh", "args": [] }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command",
            "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/verify.sh", "args": [],
            "timeout": 180, "statusMessage": "tsc + unit-тесты" }
        ]
      }
    ]
  }
}
```

`.claude/hooks/lint-changed.sh` — точечно по одному файлу, поэтому быстро:

```bash
#!/bin/bash
set -euo pipefail
file=$(jq -r '.tool_input.file_path // empty')
[ -z "$file" ] && exit 0
[ -f "$file" ] || exit 0

npx prettier --write "$file" >/dev/null 2>&1 || true

if ! out=$(npx eslint "$file" --max-warnings 0 2>&1); then
  echo "ESLint нашёл проблемы в $file:" >&2
  echo "$out" >&2
  exit 2   # PostToolUse не блокирует, но Claude увидит stderr и починит
fi
exit 0
```

`.claude/hooks/protect-secrets.sh`:

```bash
#!/bin/bash
file=$(jq -r '.tool_input.file_path // empty')
case "$file" in
  *.env|*.env.*|*id_rsa*|*.pem|*credentials*)
    jq -n '{hookSpecificOutput:{hookEventName:"PreToolUse",
            permissionDecision:"deny",
            permissionDecisionReason:"Доступ к файлам с секретами запрещён хуком"}}'
    exit 0 ;;
esac
exit 0
```

`.claude/hooks/verify.sh` — дорогие проверки в конце ответа, а не на каждую правку:

```bash
#!/bin/bash
cd "$CLAUDE_PROJECT_DIR" || exit 0
if ! out=$(npx tsc --noEmit --pretty false 2>&1); then
  jq -n --arg r "Компиляция падает:
$out" '{decision:"block", reason:$r}'
  exit 0
fi
if ! out=$(npx vitest run 'src/**/*.unit.test.ts' --reporter=dot 2>&1); then
  jq -n --arg r "Unit-тесты падают:
$out" '{decision:"block", reason:$r}'
  exit 0
fi
exit 0
```

Не забудь `chmod +x .claude/hooks/*.sh`. Скрипты используют `jq` — он должен быть в PATH. На Windows пиши хуки на PowerShell и указывай `"shell": "powershell"`.

## Диагностика

Хук не срабатывает — проверяй по порядку:

1. `/hooks` в Claude Code — меню только для чтения, показывает все настроенные хуки, их источник и полную команду. Если хука там нет, дело в файле или JSON-синтаксисе.
2. Тот ли файл настроек правил (проектный vs пользовательский), валиден ли JSON.
3. Верное ли событие: форматирование — `PostToolUse`, запрет — `PreToolUse`.
4. Матчер бьёт по имени инструмента, а не по словам промпта.
5. Скрипт исполняемый, путь абсолютный через `${CLAUDE_PROJECT_DIR}`.
6. Хук запускается вручную с подставленным JSON на stdin и возвращает ожидаемый код.
7. `claude --debug` — полный stderr и результат парсинга JSON уходят в отладочный лог.

Временная замена команды на `date >> /tmp/hook.log` мгновенно отвечает на вопрос «событие вообще приходит?».

Ещё: stdout хука должен содержать **только** JSON. Если профиль шелла что-то печатает при старте, парсинг ломается.
