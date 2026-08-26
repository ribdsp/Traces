import type { LayoutResult } from '@/types/domain'

/**
 * Geometry and stacking of specific elements at a moment in time.
 *
 * Owner: Riko. On the cut line (PLAN §4, item 2) — losing it costs the `overlay` bug class only.
 *
 * The interesting part is `overlaps`: "is an invisible element covering the button" is normally a
 * question only eyes can settle, and this turns it into arithmetic on two rectangles. It is the one
 * visual bug class an agent can diagnose without asking a human to look.
 *
 * TODO(riko), Day 6:
 *   - getBoundingClientRect plus getComputedStyle for visibility, display, zIndex
 *   - compute pairwise intersections; report the pair only when their z-indices differ
 *   - round every number: sub-pixel precision is noise a model will happily over-interpret
 */
export function measureLayout(
  _document: Document,
  _selectors: string[],
  _atMs: number,
): LayoutResult {
  throw new Error('measureLayout: not implemented')
}
