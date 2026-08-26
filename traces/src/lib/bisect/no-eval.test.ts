import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The rule from CONTRIBUTING.md, enforced by a machine instead of by memory: nothing that comes from
 * the model is ever executed.
 *
 * A grep test looks crude next to the type system, and it is — but the failure it guards against is
 * social, not technical. On Day 6 of a nine-day project, "just evaluate the expression, we'll fix it
 * later" is a genuinely tempting twenty-minute shortcut, and nothing else in the toolchain would
 * object to it. This does, out loud, in CI.
 *
 * If you are here because this test is failing: the fix is a new predicate variant with its own
 * evaluator in lib/bisect/predicate.ts, never an escape hatch.
 */

const SOURCE_ROOT = join(process.cwd(), 'src')

const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  { pattern: /\beval\s*\(/, why: 'eval() executes strings' },
  { pattern: /new\s+Function\s*\(/, why: 'new Function() compiles strings' },
  { pattern: /setTimeout\s*\(\s*['"`]/, why: 'setTimeout with a string argument evaluates it' },
  { pattern: /setInterval\s*\(\s*['"`]/, why: 'setInterval with a string argument evaluates it' },
  { pattern: /\.innerHTML\s*=\s*(?!['"`]\s*['"`])[^;]*\b(args|input|params|predicate|payload)\b/,
    why: 'assigning model-supplied text to innerHTML' },
]

function collectSourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      collectSourceFiles(path, found)
      continue
    }
    if (!/\.tsx?$/.test(entry.name)) continue
    // This file names the forbidden constructs in order to look for them.
    if (entry.name === 'no-eval.test.ts') continue
    found.push(path)
  }
  return found
}

describe('nothing from the model is ever executed', () => {
  const files = collectSourceFiles(SOURCE_ROOT)

  it('finds source files to scan (a passing-because-empty test would be worse than none)', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  for (const { pattern, why } of FORBIDDEN) {
    it(`contains no ${pattern.source} — ${why}`, () => {
      const offenders = files.filter((file) => {
        const source = readFileSync(file, 'utf8')
        return source
          .split('\n')
          .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
          .some((line) => pattern.test(line))
      })
      expect(offenders, `forbidden construct in:\n${offenders.join('\n')}`).toEqual([])
    })
  }
})
