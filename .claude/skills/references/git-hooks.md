# Git hooks — справочник (husky / lefthook / lint-staged)

Оглавление: [Какие хуки нужны](#какие-хуки-нужны) · [husky](#husky) · [lefthook](#lefthook) · [lint-staged](#lint-staged) · [Типовые поломки](#типовые-поломки)

## Какие хуки нужны

Распределение по цене проверки — иначе хуки начнут обходить через `--no-verify`:

| Хук | Бюджет | Что запускать |
|---|---|---|
| `pre-commit` | < 5с | prettier + eslint по staged-файлам, gitleaks |
| `commit-msg` | мгновенно | commitlint (Conventional Commits) |
| `pre-push` | < 60с | `tsc --noEmit`, unit-тесты |
| CI | без лимита | полный pipeline: integration, e2e, security, аудит принципов |

Правило: локальные хуки — быстрая обратная связь, CI — гарантия. Дублировать всё локально бессмысленно, а полагаться только на локальное — опасно: хук пропускается одним флагом.

`tsc` не кладут в `pre-commit`, потому что он проверяет проект целиком и растёт вместе с ним; на `pre-push` это приемлемо.

## husky

```bash
npm install --save-dev husky lint-staged
npx husky init
```

`husky init` добавляет в package.json:

```json
{ "scripts": { "prepare": "husky" } }
```

`prepare` выполняется после `npm install` — без него у коллеги хуки просто не установятся. В CI используется `npm ci`, где хуки не нужны: `HUSKY=0 npm ci`.

`.husky/pre-commit`:

```bash
npx lint-staged
npx gitleaks protect --staged --no-banner --redact
```

`.husky/pre-push`:

```bash
npx tsc --noEmit || exit 1
npx vitest run 'src/**/*.unit.test.ts' || exit 1
```

`.husky/commit-msg`:

```bash
npx commitlint --edit "$1"
```

В git-хуках, в отличие от хуков Claude Code, блокирует **любой ненулевой код возврата**.

## lefthook

Альтернатива на одном YAML, умеет параллелить — заметно быстрее на больших репозиториях.

```yaml
# lefthook.yml
pre-commit:
  parallel: true
  commands:
    format:
      glob: "*.{ts,tsx,json,md}"
      run: npx prettier --write {staged_files}
      stage_fixed: true
    lint:
      glob: "*.{ts,tsx}"
      run: npx eslint {staged_files} --max-warnings 0
    secrets:
      run: npx gitleaks protect --staged --no-banner --redact

pre-push:
  commands:
    typecheck:
      run: npx tsc --noEmit
    unit:
      run: npx vitest run 'src/**/*.unit.test.ts'
```

Установка: `npm i -D lefthook && npx lefthook install` (тоже вешается на `prepare`).

`stage_fixed: true` — критично: без него автоисправления не попадут в коммит.

## lint-staged

```json
{
  "lint-staged": {
    "*.{ts,tsx}": ["prettier --write", "eslint --max-warnings 0 --fix"],
    "*.{json,md,yml}": ["prettier --write"]
  }
}
```

Смысл в том, что проверяются только проиндексированные файлы — время хука не зависит от размера репозитория. lint-staged сам делает `git add` для изменённых файлов.

Не помещай сюда `tsc`: он не умеет проверять отдельные файлы в отрыве от проекта, и запуск по списку staged-файлов даёт ложные ошибки.

## Типовые поломки

| Симптом | Причина | Что делать |
|---|---|---|
| Хуки не работают у коллеги | нет `prepare`-скрипта или `core.hooksPath` не настроен | `npx husky init`, проверить `git config core.hooksPath` |
| В коммит уехал неотформатированный файл | форматтер поменял файл, но не сделал `git add` | lint-staged делает это сам; в lefthook — `stage_fixed: true` |
| Хуки массово обходят через `--no-verify` | pre-commit дольше 5 секунд | вынести тесты и tsc на pre-push/CI |
| Хук падает только в CI | `npm ci` не ставит хуки, а CI и не должен на них полагаться | ставить `HUSKY=0` и прогонять pipeline явными шагами |
| Хук падает на файлах с пробелами в имени | не закавычен `{staged_files}` | закавычить или использовать lint-staged |
| gitleaks срабатывает на тестовых фикстурах | ложное срабатывание | `.gitleaksignore` с комментарием, почему, а не отключение хука |

Отдельно: `--no-verify` должен оставаться доступным — это аварийный клапан. Проблема не в том, что его используют, а в том, что его используют постоянно; это симптом медленного хука, а не недисциплинированности.
