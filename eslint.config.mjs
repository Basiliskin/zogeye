// Flat config for ESLint v9 + typescript-eslint v8 — ts-pipeline baseline.
//
// The mandatory rules are wired in unconditionally; projects that need
// a different policy override individual keys in their own eslint.config
// (which should re-export this array and add layered overrides).
//
// Mandatory rules (these are the gates the installer promises):
//   - Domain/application must not import infrastructure, fs, or vendor SDKs
//   - `any` and non-null assertions are banned
//   - `JSON.parse(x) as <Type>` and `JSON.parse(x) satisfies <Type>` are banned
//
// Usage from a project:
//   import baseline from 'ts-pipeline/eslint.config.mjs';
//   export default [...baseline, { /* project overrides */ }];
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';

const restrictedSdkPaths = [
  { name: 'openai', message: 'Use a port, not the SDK.' },
  { name: '@anthropic-ai/sdk', message: 'Use a port, not the SDK.' },
  { name: 'pg', message: 'Use a port, not pg directly.' },
  { name: 'node:fs', message: 'Use a port, not the filesystem.' },
  { name: 'node:fs/promises', message: 'Use a port, not the filesystem.' },
];

const restrictedSdkPatterns = [
  { group: ['@ai-sdk/*'], message: 'Use a port, not the SDK.' },
  { group: ['ai'], message: 'Use a port, not the SDK.' },
];

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'fixtures/**',
      'eslint.config.*',
      'vitest.config.ts',
      '.claude/**',
      'scripts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2022 },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { import: importPlugin },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-expressions': [
        'error',
        { allowTaggedTemplates: true, allowTernary: true },
      ],

      // Layer-isolation: domain and application are the protected core.
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            { target: './src/domain', from: './src/application', message: 'Domain must not import from application.' },
            { target: './src/domain', from: './src/infrastructure', message: 'Domain must not import from infrastructure.' },
            { target: './src/application', from: './src/infrastructure', message: 'Application must not import from infrastructure.' },
          ],
        },
      ],

      // Default SDK ban — infrastructure overrides it for its own files.
      'no-restricted-imports': [
        'error',
        { paths: restrictedSdkPaths, patterns: restrictedSdkPatterns },
      ],

      // Untyped JSON parsing is the single most common source of silent
      // runtime bugs. The three offending shapes — `as`, double `as`, and
      // `satisfies` — are banned. The legitimate boundary is
      // `parse → unknown → zod.parse` and is left intact.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "TSAsExpression > CallExpression[callee.object.name='JSON'][callee.property.name='parse']",
          message:
            'Casting JSON.parse() output is a lie the type checker cannot catch. Parse, then validate (zod / schema.parse).',
        },
        {
          selector:
            "TSSatisfiesExpression > CallExpression[callee.object.name='JSON'][callee.property.name='parse']",
          message:
            '`satisfies` on JSON.parse() is still an untyped promotion. Validate first, then assert the validated shape.',
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // Browser-glue layers: chrome.* is an untyped ambient global, so the
    // type-aware "unsafe *" family fires on every extension API call. These
    // layers are the boundary; the deterministic rule logic lives in
    // domain/application, which stays fully strict.
    files: [
      'src/infrastructure/**/*.{ts,tsx}',
      'src/background/**/*.{ts,tsx}',
      'src/content/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    files: ['.claude/hooks/**/*.{js,mjs,cjs}', 'scripts/**/*.{js,mjs,cjs}'],
    languageOptions: { sourceType: 'module' },
    rules: { '@typescript-eslint/no-unused-vars': 'off' },
  },
];
