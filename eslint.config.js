import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Build output, native iOS project (CocoaPods/Capacitor output), third-party
  // assets, and generated schedule JSON are not our lint surface.
  globalIgnores(['dist', 'ios', 'assets', 'public', 'schedule-data*', '**/node_modules']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    // Node-side code: Vercel serverless functions, the schedule processor, and
    // the Vite config itself.
    files: ['api/**/*.js', 'schedule-processor/**/*.js', 'vite.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
])
