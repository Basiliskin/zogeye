#!/usr/bin/env node
// Проверяет, что для изменённых исходников есть тесты нужного уровня
// и что каждый экспортируемый символ упоминается в тестах.
//
//   node check-tests.mjs --changed                 # файлы из git diff
//   node check-tests.mjs --files src/a.ts src/b.ts
//   node check-tests.mjs --changed --hook stop     # JSON-решение для хука Stop
//   node check-tests.mjs --staged                  # для git pre-commit
//
// Коды выхода: 0 — всё покрыто, 2 — есть пробелы, 1 — ошибка запуска.

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const DEFAULT_CONFIG = {
  srcDir: 'src',
  // какой уровень тестов требуется для какого пути (первое совпадение выигрывает)
  levels: [
    { match: '^src/domain/', suffix: '.unit.test.ts', level: 'unit' },
    { match: '^src/application/', suffix: '.unit.test.ts', level: 'unit' },
    { match: '^src/infrastructure/', suffix: '.int.test.ts', level: 'integration' },
    { match: '^src/(cli|main|index)\\.ts$', suffix: '.e2e.test.ts', level: 'e2e' },
    { match: '.*', suffix: '.unit.test.ts', level: 'unit' },
  ],
  // где искать файл теста, {base} — имя исходника без расширения, {dir} — его директория
  testLocations: ['{dir}/{base}{suffix}', 'tests/{base}{suffix}', '{dir}/__tests__/{base}{suffix}'],
  ignore: ['\\.d\\.ts$', '\\.test\\.ts$', '\\.spec\\.ts$', '/types\\.ts$', '/ports\\.ts$', '/index\\.ts$'],
  requireSymbolMentions: true,
};

function loadConfig() {
  const p = '.testguard.json';
  if (!existsSync(p)) return DEFAULT_CONFIG;
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(p, 'utf8')) };
  } catch (e) {
    console.error(`Не удалось прочитать ${p}: ${e.message}`);
    process.exit(1);
  }
}

function parseArgs(argv) {
  const args = { files: [], mode: null, hook: null, base: 'origin/main' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--changed' || a === '--staged') args.mode = a.slice(2);
    else if (a === '--base') { args.mode = 'base'; args.base = argv[++i]; }
    else if (a === '--hook') args.hook = argv[++i];
    else if (a === '--files') { while (argv[i + 1] && !argv[i + 1].startsWith('--')) args.files.push(argv[++i]); }
    else if (a === '--help') { console.log(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 12).join('\n')); process.exit(0); }
  }
  return args;
}

function gitFiles(mode, base) {
  const cmd =
    mode === 'staged' ? 'git diff --cached --name-only --diff-filter=ACMR'
    : mode === 'base' ? `git diff --name-only --diff-filter=ACMR ${base}...HEAD`
    : 'git diff --name-only --diff-filter=ACMR HEAD';
  try {
    return execSync(cmd, { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    console.error('git недоступен или это не репозиторий — укажи файлы через --files');
    process.exit(1);
  }
}

/** Достаём имена экспортов. Используем TS compiler API, если он есть; иначе regex. */
async function extractExports(file, source) {
  try {
    // typescript ищем в проекте пользователя, а не рядом со скриптом
    const require = createRequire(path.join(process.cwd(), 'noop.cjs'));
    const ts = require('typescript');
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const names = [];
    const isExported = (n) => n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const isTypeOnly = (n) =>
      ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) ||
      (ts.isEnumDeclaration(n) && n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ConstKeyword));

    for (const st of sf.statements) {
      if (!isExported(st)) continue;
      if (isTypeOnly(st)) continue; // типы тестировать нечем
      if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) {
        if (st.name) names.push(st.name.text);
      } else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name)) names.push(d.name.text);
        }
      }
    }
    return { names, parser: 'typescript' };
  } catch {
    const names = [];
    const re = /^export\s+(?:async\s+)?(?:function|class|const|let)\s+([A-Za-z_$][\w$]*)/gm;
    let m;
    while ((m = re.exec(source))) names.push(m[1]);
    return { names, parser: 'regex' };
  }
}

function levelFor(file, cfg) {
  const norm = file.split(path.sep).join('/');
  return cfg.levels.find((l) => new RegExp(l.match).test(norm)) ?? cfg.levels.at(-1);
}

function candidateTestPaths(file, suffix, cfg) {
  const dir = path.dirname(file);
  const base = path.basename(file, '.ts');
  return cfg.testLocations.map((t) =>
    t.replaceAll('{dir}', dir).replaceAll('{base}', base).replaceAll('{suffix}', suffix),
  );
}

async function main() {
  const cfg = loadConfig();
  const args = parseArgs(process.argv.slice(2));
  let files = args.files.length ? args.files : args.mode ? gitFiles(args.mode, args.base) : [];

  if (!files.length) {
    report({ checked: 0, problems: [] }, args.hook);
    return;
  }

  const ignore = cfg.ignore.map((r) => new RegExp(r));
  files = files.filter((f) => f.endsWith('.ts') && !ignore.some((r) => r.test('/' + f)));

  const problems = [];
  let parserUsed = 'regex';
  try { createRequire(path.join(process.cwd(), 'noop.cjs'))('typescript'); parserUsed = 'typescript'; } catch { /* fallback */ }

  for (const file of files) {
    if (!existsSync(file)) continue; // удалён
    const { suffix, level } = levelFor(file, cfg);
    const candidates = candidateTestPaths(file, suffix, cfg);
    const testFile = candidates.find(existsSync);

    // Type-only modules (interfaces / type aliases only — no runnable
    // exports) have nothing to runtime-test; skip them the same way the
    // symbol-mention pass ignores `interface`/`type` declarations.
    const src = readFileSync(file, 'utf8');
    const { names } = await extractExports(file, src);
    if (names.length === 0) continue;

    if (!testFile) {
      problems.push({
        file, level, kind: 'missing-file',
        detail: `нет теста уровня ${level}`,
        hint: `создай ${candidates[0]}`,
      });
      continue;
    }

    if (!cfg.requireSymbolMentions) continue;

    const testSrc = candidates.filter(existsSync).map((p) => readFileSync(p, 'utf8')).join('\n');
    const untested = names.filter((n) => !new RegExp(`\\b${n}\\b`).test(testSrc));

    if (untested.length) {
      problems.push({
        file, level, kind: 'missing-symbols',
        detail: `экспорты без упоминания в тестах: ${untested.join(', ')}`,
        hint: `добавь кейсы в ${testFile}`,
      });
    }
  }

  report({ checked: files.length, problems, parser: parserUsed }, args.hook);
}

function report({ checked, problems, parser }, hook) {
  if (!problems.length) {
    if (!hook) console.log(`Тесты на месте: проверено файлов — ${checked}`);
    process.exit(0);
  }

  const lines = problems.map((p) => `  ${p.file} [${p.level}] — ${p.detail}\n    → ${p.hint}`);
  const text = `Не хватает тестов (${problems.length}):\n${lines.join('\n')}` +
    (parser === 'regex' ? '\n  (typescript не найден — список экспортов определён приблизительно)' : '');

  if (hook === 'stop') {
    // Stop-хук: блокируем завершение ответа, Claude увидит reason и допишет тесты
    process.stdout.write(JSON.stringify({ decision: 'block', reason: text }));
    process.exit(0);
  }

  console.error(text);
  process.exit(2);
}

main().catch((e) => {
  console.error(`check-tests: ${e.message}`);
  process.exit(1);
});
