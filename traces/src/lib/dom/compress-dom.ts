import type { CompressedDomResult } from '@/types/domain'

/**
 * The agent-legible DOM representation.
 *
 * Owner: Riko. Full specification: docs/agent-legible-dom.md.
 *
 * This is the most consequential file in the project, and the reason is worth stating plainly: an
 * unbudgeted DOM dump is a *silent* failure. Send 800 KB of HTML and nothing throws — the agent
 * keeps answering, just worse, until its context is full of markup and it has forgotten the question.
 * Every rule below exists to keep a few hundred kilobytes of markup under about nine hundred
 * characters of state a model can actually reason about.
 */

/** Hard budget. Enforced by compress-dom.test.ts, not by good intentions. */
export const MAX_LINES = 60
export const MAX_CHARS = 1200
export const MAX_DEPTH = 6
export const MAX_TEXT_CHARS = 60

/**
 * Attributes worth a model's tokens. Everything else is dropped.
 *
 * `class` is excluded on purpose — utility classes are the single largest source of noise in a
 * Tailwind app and they carry almost no state. One short semantic class survives (see the spec).
 */
export const ATTRIBUTE_WHITELIST = [
  'id',
  'name',
  'type',
  'role',
  'value',
  'placeholder',
  'href',
  'src',
  'alt',
  'disabled',
  'checked',
  'readonly',
  'required',
  'selected',
  'hidden',
  'aria-label',
  'aria-invalid',
  'aria-expanded',
  'aria-disabled',
  'data-testid',
] as const

/** Appended when the budget clips output. Phrased as an instruction: agents act on those. */
export const TRUNCATION_NOTE = '... truncated at budget — narrow the scope with a more specific selector'

export type CompressOptions = {
  /** Subtree to compress. Defaults to the document body. */
  root?: Element
  atMs: number
}

/**
 * TODO(riko), Day 2 — write the test first, it is already in compress-dom.test.ts.
 *
 * Inclusion rules, in order:
 *   1. interactive elements: input, select, textarea, button, a, [role=button], [tabindex]
 *   2. state-bearing elements: [disabled], [aria-invalid], [hidden], anything with a validation role
 *   3. text that a user could read and act on, truncated to MAX_TEXT_CHARS
 *   4. structural ancestors of the above, only as far as needed to keep the tree legible
 *
 * Everything else — layout wrappers, decorative spans, svg internals — is discarded entirely.
 *
 * Two annotations earn their tokens many times over:
 *   - `[empty options: 0]` on a select, which is the whole `empty-province` bug in nine characters
 *   - `[DISABLED]`, because a model reads it more reliably than `disabled=""`
 */
export function compressDom(_options: CompressOptions): CompressedDomResult {
  throw new Error('compressDom: not implemented')
}
