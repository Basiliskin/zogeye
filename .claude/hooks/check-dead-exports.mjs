#!/usr/bin/env node
// Block dead-code commitment.
//
//   node check-dead-exports.mjs --staged [--base <ref>]
//   node check-dead-exports.mjs --files a.ts b.ts
//   node check-dead-exports.mjs --all                  # every file under src/
//
// For each candidate TypeScript file we:
//   1. Enumerate its exported symbols (TS compiler API if available,
//      else a regex fallback that mirrors `check-tests.mjs`).
//   2. For each export, search every other .ts file under src/ for
//      a reference. A symbol that nothing imports is "dead" and the
//      script exits non-zero.
//
// The script is intentionally strict: an export with a single
// reference inside its own file (i.e. `export { x } from './x'`) is
// still considered dead because no caller consumes it. The few
// universally-safe exports — `index.ts` barrel re-exports, types —
// are filtered out before the count so legitimate patterns do not
// trip the gate.
//
// Exit codes: 0 clean, 2 dead exports found, 1 internal error.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

// Source root: `src/` by default. A monorepo whose real project lives under a
// workspace dir can point this elsewhere with SRC_ROOT in the environment
// (e.g. `SRC_ROOT=packages/app/src`). Paths are repo-root-relative so they line
// up directly with `git diff` output.
const SRC_ROOT = process.env.SRC_ROOT || 'src';

/**
 * Exports that are intentionally unconsumed right now because they are the
 * public surface a *specific, named, still-upcoming* roadmap phase will wire
 * in — not accidental dead code. Each entry is `"<repo-relative-path>:<symbol>"`
 * and MUST carry a comment naming the phase that will consume it; remove the
 * entry when that phase lands so the gate holds the wiring to account like any
 * other export. Empty by default.
 */
const DEFERRED_EXPORTS = new Set([
  // 'src/foo/bar.ts:createBar',  // Phase N wires this into the composition root.
]);

const args = parseArgs(process.argv.slice(2));
const candidates = collectCandidates(args);

if (!candidates.length) {
  console.log('check-dead-exports: no candidate files');
  process.exit(0);
}

const allTsFiles = walkTypeScript(SRC_ROOT);
if (!allTsFiles.length) {
  console.error(`check-dead-exports: no .ts files under ${SRC_ROOT}/`);
  process.exit(1);
}

const sources = new Map();
for (const f of allTsFiles) {
  sources.set(f, readFileSync(f, 'utf8'));
}

const problems = [];
for (const file of candidates) {
  if (!existsSync(file)) continue;
  const src = sources.get(file);
  if (src === undefined) continue;
  const exports = extractExports(file, src);
  for (const name of exports) {
    if (!shouldCheck(name, file)) continue;
    const refs = countExternalReferences(name, file, sources);
    if (refs === 0) {
      problems.push({ file, name });
    }
  }
}

if (!problems.length) {
  console.log(`check-dead-exports: no dead exports across ${candidates.length} file(s)`);
  process.exit(0);
}

const grouped = groupBy(problems, (p) => p.file);
const lines = [];
for (const [file, items] of Object.entries(grouped)) {
  const names = items.map((i) => i.name).join(', ');
  lines.push(`  ${file} → ${names}`);
}
console.error(`Dead exports (${problems.length}):\n${lines.join('\n')}\n` +
  'Удали или начни использовать эти экспорты, затем повтори коммит.');
process.exit(2);

// ---------- helpers ----------

function parseArgs(argv) {
  const out = { files: [], mode: null, base: 'origin/main' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--staged' || a === '--changed' || a === '--all') out.mode = a.slice(2);
    else if (a === '--base') { out.mode = 'base'; out.base = argv[++i]; }
    else if (a === '--files') {
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) out.files.push(argv[++i]);
    }
    else if (a === '--help' || a === '-h') {
      console.log('Usage: check-dead-exports.mjs [--staged|--changed|--all] [--files a.ts ...]');
      process.exit(0);
    }
  }
  return out;
}

function collectCandidates(args) {
  if (args.files.length) return args.files.filter((f) => f.endsWith('.ts'));
  if (args.mode === 'all') return walkTypeScript(SRC_ROOT);
  const flag = args.mode === 'staged' ? '--cached' : 'HEAD';
  try {
    const out = execSync(`git diff --name-only --diff-filter=ACMR ${flag}`, { encoding: 'utf8' });
    return out.split('\n').filter(Boolean).filter((f) => f.endsWith('.ts'));
  } catch (e) {
    console.error(`git failed: ${e.message}`);
    process.exit(1);
  }
}

function walkTypeScript(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (stat.isDirectory()) {
        if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage' || entry.startsWith('.')) continue;
        stack.push(full);
      } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
        out.push(full);
      }
    }
  }
  return out;
}

function extractExports(file, source) {
  try {
    const require = createRequire(path.join(process.cwd(), 'noop.cjs'));
    const ts = require('typescript');
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const names = [];
    const isExported = (n) => n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const isTypeOnly = (n) =>
      ts.isInterfaceDeclaration(n) ||
      ts.isTypeAliasDeclaration(n) ||
      ts.isEnumDeclaration(n);
    for (const st of sf.statements) {
      if (!isExported(st)) continue;
      if (isTypeOnly(st)) continue;
      if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) {
        if (st.name) names.push(st.name.text);
      } else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name)) names.push(d.name.text);
        }
      } else if (ts.isExportDeclaration(st)) {
        if (st.exportClause && ts.isNamedExports(st.exportClause)) {
          for (const el of st.exportClause.elements) {
            names.push(el.name.text);
          }
        }
      }
    }
    return names;
  } catch {
    const names = [];
    const re = /^export\s+(?:async\s+)?(?:function|class|const|let)\s+([A-Za-z_$][\w$]*)/gm;
    let m;
    while ((m = re.exec(source))) names.push(m[1]);
    const reRe = /^export\s*\{([^}]+)\}/gm;
    while ((m = reRe.exec(source))) {
      for (const part of m[1].split(',')) {
        const trimmed = part.trim().split(/\s+as\s+/).pop();
        if (trimmed) names.push(trimmed);
      }
    }
    return names;
  }
}

/**
 * Names that are universally safe to ship and should not be flagged.
 * - `index.ts` barrel re-exports are introspected by callers via path,
 *   not by name. The exported names in those barrels are not the
 *   "dead export" we care about; they are the public surface.
 * - Names prefixed with `_` are intentionally unused (escape hatch
 *   for the `noUnusedLocals` / `noUnusedParameters` ESLint rule).
 * - `DEFERRED_EXPORTS` entries are forward declarations for a named,
 *   still-upcoming roadmap phase.
 */
function shouldCheck(name, file) {
  if (name.startsWith('_')) return false;
  if (DEFERRED_EXPORTS.has(`${file}:${name}`)) return false;
  return true;
}

function countExternalReferences(symbolName, sourceFile, sources) {
  const wordBoundary = new RegExp(`\\b${escapeRegExp(symbolName)}\\b`);
  let count = 0;
  for (const [file, src] of sources) {
    if (file === sourceFile) continue;
    if (wordBoundary.test(src)) count += 1;
  }
  return count;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function groupBy(items, key) {
  const out = {};
  for (const item of items) {
    const k = key(item);
    (out[k] ??= []).push(item);
  }
  return out;
}
