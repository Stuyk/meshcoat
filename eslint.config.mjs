import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out'] },
  tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    rules: {
      curly: ['error', 'all'],
      // Prefer guard clauses (early return) over nested if/else — flags an
      // if-branch that ends in return/throw/continue/break followed by an
      // else, since that else is dead structure once the branch always exits.
      'no-else-return': ['error', { allowElseIf: false }],
      // No hard rule for "no nested if" exists; capping block depth is the
      // closest enforceable proxy — past this, restructure into early
      // returns instead of adding another nesting level.
      'max-depth': ['error', 3]
    }
  }
)
