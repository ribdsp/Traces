import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FlatCompat } from '@eslint/eslintrc'

/*
 * Same shape as `traces/eslint.config.mjs`, and for the same reason: `eslint-config-next@15.5`
 * still ships eslintrc-format objects, so `compat.extends()` is the only form that resolves,
 * and `next lint` with no config on disk drops into an interactive prompt rather than linting.
 */
const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
})

const eslintConfig = [
  {
    ignores: ['.next/**', 'out/**', 'node_modules/**', 'public/**', 'next-env.d.ts'],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
]

export default eslintConfig
