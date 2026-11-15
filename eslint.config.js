// ESLint v9+ flat config (migrated from .eslintrc.json).
// typescript-eslint v8 removed the stylistic `@typescript-eslint/semi` rule,
// so it is intentionally dropped here; semicolons are left to the formatter.
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

module.exports = [
    {
        ignores: ['out/**', 'dist/**', '**/*.d.ts'],
    },
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 2022,
                sourceType: 'module',
            },
        },
        plugins: {
            '@typescript-eslint': tsPlugin,
        },
        rules: {
            '@typescript-eslint/naming-convention': 'warn',
            'curly': 'warn',
            'eqeqeq': 'warn',
            'no-throw-literal': 'warn',
            'semi': 'off',
        },
    },
];
