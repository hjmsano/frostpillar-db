import path from 'node:path';
import { fileURLToPath } from 'node:url';

import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const typeScriptFiles = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'];

const toTypeScriptScope = (config) => {
  return {
    ...config,
    files: Array.isArray(config.files) ? config.files : typeScriptFiles,
  };
};

const recommendedTypeCheckedConfigs =
  tseslint.configs.recommendedTypeChecked.map(toTypeScriptScope);
const stylisticTypeCheckedConfigs =
  tseslint.configs.stylisticTypeChecked.map(toTypeScriptScope);
const eslintRecommendedConfig = {
  ...eslint.configs.recommended,
  files: typeScriptFiles,
};

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.tmp-test-dist/**',
      '.tmp-bench-dist/**',
      '.claude/**',
    ],
  },
  eslintRecommendedConfig,
  ...recommendedTypeCheckedConfigs,
  ...stylisticTypeCheckedConfigs,
  {
    files: typeScriptFiles,
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.typecheck.json'],
        tsconfigRootDir: projectRoot,
      },
    },
    rules: {
      '@typescript-eslint/consistent-indexed-object-style': 'off',
      '@typescript-eslint/only-throw-error': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/prefer-optional-chain': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'max-lines': [
        'warn',
        { max: 300, skipBlankLines: true, skipComments: true },
      ],
      'max-lines-per-function': [
        'warn',
        {
          max: 50,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // Test files are naturally long; splitting them by line count fragments
    // cohesive suites without improving readability.
    files: ['tests/**'],
    rules: {
      'max-lines': 'off',
    },
  },
  eslintConfigPrettier,
);

export default eslintConfig;
