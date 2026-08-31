import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FlatCompat } from '@eslint/eslintrc'

/*
 * Flat config, driven through `FlatCompat`, because `eslint-config-next@15.5` still ships
 * eslintrc-format objects — `core-web-vitals.js` is a bare `module.exports = { extends: [...] }`,
 * not a flat array. Next 16 adds real flat exports you can spread directly; until this project
 * moves, `compat.extends()` is the only form that resolves.
 *
 * This file exists because `next lint` is gone in Next 16 and already deprecated here: with no
 * config on disk it drops into an interactive "how would you like to configure ESLint?" prompt,
 * so `npm run lint` in a clean clone never returns a lint result at all. The script now calls
 * `eslint .` directly.
 */
const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
})

export default [
  {
    ignores: ['.next/**', 'out/**', 'node_modules/**', 'public/**'],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
]
