import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
    {
        ignores: [
            'dist/**',
            'bin/**',
            'client/dist/**',
            'client/server/**',
            'client/dist-test/**',
            'client/out/**',
            'client/.vscode-test/**',
            'node_modules/**',
            '**/node_modules/**',
            '.claude/**',
            '**/*.test.ts',
            '**/*.spec.ts',
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['src/**/*.ts', 'client/src/**/*.{ts,tsx}'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
        },
        rules: {
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            '@typescript-eslint/explicit-module-boundary-types': 'warn',
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-require-imports': 'off',
            'no-case-declarations': 'off',
            'no-useless-escape': 'off',
            'prefer-const': 'off',
        },
    },
];
