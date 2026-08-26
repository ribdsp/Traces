import type { DomDiffResult } from '@/types/domain'

/** `diff_dom` never returns more changes than this. */
export const MAX_CHANGES = 30

/**
 * What changed between two moments, as a short list.
 *
 * Owner: Riko.
 *
 * Compare two *compressed* trees, not two raw ones. A raw diff of a React app is mostly reordered
 * class strings and regenerated ids — technically accurate, useless to a model, and expensive.
 *
 * TODO(riko), Day 3:
 *   - accept two documents (already positioned by the caller), compress both, diff by stable selector
 *   - stable selector = id when present, else nearest [name]/[data-testid], else tag plus index
 *   - report added / removed / attributeChanged / textChanged, both sides truncated
 *   - on truncation, prefer changes on interactive elements over text changes
 */
export function diffDom(
  _before: { document: Document; atMs: number },
  _after: { document: Document; atMs: number },
): DomDiffResult {
  throw new Error('diffDom: not implemented')
}
