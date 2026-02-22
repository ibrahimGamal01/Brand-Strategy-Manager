import js from '@eslint/js';
import next from 'eslint-config-next';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['.next', 'dist', 'node_modules'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...next,
  {
    rules: {
      // We intentionally allow occasional explicit any in legacy areas; prefer fixing over time.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Hooks rule from lint output was noisy in legacy files; keep as warn while refactoring.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
];
