// eslint.config.js — flat config (ESLint v9+) for TypeScript + Svelte 5,
// shared across the whole monorepo. Mirrors ../omx-viewer/apps/web/eslint.config.js.

import js from '@eslint/js'
import svelte from 'eslint-plugin-svelte'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import globals from 'globals'

export default [
  js.configs.recommended,
  ...svelte.configs['flat/recommended'],

  // TypeScript rules — applied to both .ts files and .svelte script blocks,
  // since the base (non-TS-aware) no-unused-vars can't see type-only usage
  // like Props interface destructuring inside <script lang="ts">.
  {
    files: ['**/*.ts', '**/*.svelte'],
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
    },
  },

  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      globals: { ...globals.browser, ...globals.worker, ...globals.node, ...globals.es2022 },
    },
  },

  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: {
        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: 'module',
        extraFileExtensions: ['.svelte'],
      },
      globals: { ...globals.browser, ...globals.worker, ...globals.es2022 },
    },
  },

  {
    rules: {
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always'],
      'svelte/valid-compile': 'warn',
      'svelte/no-unused-svelte-ignore': 'warn',
    },
  },

  // Constitution Principle II: packages/core and packages/ui are
  // host-agnostic. They must never import the `vscode` API, call
  // `acquireVsCodeApi`, or touch the File API / IndexedDB directly — all
  // platform access goes through HostAdapter (contracts/host-adapter.md).
  {
    files: ['packages/core/**/*.ts', 'packages/ui/**/*.ts', 'packages/ui/**/*.svelte'],
    rules: {
      'no-restricted-imports': ['error', { paths: [{ name: 'vscode', message: 'packages/core and packages/ui are host-agnostic (Constitution II). Use HostAdapter instead.' }] }],
      'no-restricted-globals': [
        'error',
        { name: 'acquireVsCodeApi', message: 'packages/core and packages/ui are host-agnostic (Constitution II). Use HostAdapter instead.' },
        { name: 'indexedDB', message: 'packages/core and packages/ui are host-agnostic (Constitution II); do not use IndexedDB directly. Use HostAdapter.saveFile/loadState instead.' },
        { name: 'FileReader', message: 'packages/core and packages/ui are host-agnostic (Constitution II); do not use the File API directly. Use HostAdapter.openFiles/getFileSource instead.' },
      ],
    },
  },

  {
    ignores: [
      'legacy/',
      '**/dist/',
      '**/dist-webview/',
      '**/out/',
      '**/node_modules/',
      '**/*.min.js',
    ],
  },
]
