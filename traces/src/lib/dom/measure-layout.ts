import type { LayoutBox, LayoutResult } from '@/types/domain'

/**
 * Geometry and stacking of specific elements at a moment in time.
 *
 * On the cut line (PLAN §4, item 2) — losing it costs the `overlay` bug class only.
 *
 * The interesting part is `overlaps`: "is an invisible element covering the button" is normally a
 * question only eyes can settle, and this turns it into arithmetic on two rectangles. It is the one
 * visual bug class an agent can diagnose without asking a human to look.
 *
 * What shipped, and the decisions behind it. Each is also called out
 * inline, next to the code that makes it, because a decision explained only up here goes stale the
 * first time someone edits the code below without reading this far:
 *   - getBoundingClientRect plus getComputedStyle for visibility, display, zIndex — see
 *     buildLayoutBox and toVisibility.
 *   - pairwise intersection over every matched element; a pair is reported only when its z-indices
 *     differ — see computeOverlaps and zIndexRank for what "differ" means once 'auto' is involved.
 *   - every number is rounded once, at construction, so later arithmetic (intersection area, z-index
 *     comparison) agrees with what the agent actually sees — see buildLayoutBox.
 */
export function measureLayout(document: Document, selectors: string[], atMs: number): LayoutResult {
  const matches = resolveMatches(document, selectors)
  const boxes = matches.map(({ selector, element }) => buildLayoutBox(selector, element))
  return { atMs, boxes, overlaps: computeOverlaps(boxes) }
}

/**
 * Turn each requested selector into zero or more (selector, element) pairs, in document order.
 *
 * Three cases, decided deliberately rather than left to fall out of whatever `querySelectorAll`
 * happens to do:
 *
 * - **No match.** Skipped — not reported as an error, and not represented by a placeholder box.
 *   `LayoutBox` has no field for "this didn't exist" (unlike `BisectStep.elementMissing`, there is
 *   nowhere in the frozen contract to put that here). This is recoverable, not silent: the caller
 *   supplied the selector list, so it can always diff what it asked for against
 *   `boxes.map(b => b.selector)` to see which selectors came back empty. A `notFound: string[]` field
 *   on `LayoutResult` would remove even that one step — see the final report.
 * - **Exactly one match.** The box's `selector` is the input selector, verbatim. The common case is
 *   not relabelled.
 * - **Several matches.** Every match gets its own box. Keeping only the first would silently hide the
 *   others from an agent that has no way to know they existed, and "first" is exactly the kind of
 *   choice that looks fine in one recording and wrong in the next once the DOM order changes.
 *   Matches are disambiguated as `"<selector> [match i/N]"`, not a synthesized CSS selector (e.g. an
 *   `nth-of-type` guess): a synthesized selector can drift out from under a DOM that has since
 *   mutated and silently resolve to the *wrong* element if an agent feeds it back into a later call,
 *   whereas `[match i/N]` cannot be mistaken for real CSS — fed back verbatim, it fails loudly as an
 *   invalid selector instead of quietly matching something else.
 */
function resolveMatches(document: Document, selectors: string[]): { selector: string; element: Element }[] {
  const matches: { selector: string; element: Element }[] = []

  for (const selector of selectors) {
    const elements = queryAll(document, selector)
    elements.forEach((element, index) => {
      const label = elements.length === 1 ? selector : `${selector} [match ${index + 1}/${elements.length}]`
      matches.push({ selector: label, element })
    })
  }

  return matches
}

/**
 * `querySelectorAll`, but a malformed selector becomes a readable error instead of a raw
 * `SyntaxError` thrown from inside the DOM implementation (docs/threat-model.md T2: an invalid
 * selector is rejected with a message that names the offending string, not a stack trace).
 */
function queryAll(document: Document, selector: string): Element[] {
  try {
    return Array.from(document.querySelectorAll(selector))
  } catch {
    throw new Error(`'${selector}' is not a valid CSS selector.`)
  }
}

/**
 * One element's geometry and stacking, rounded.
 *
 * Rounding happens once, here, so every later computation (intersection area, z-index comparison)
 * runs on the exact integers the agent eventually sees — there is no path where a box looks like it
 * shouldn't overlap because the overlap math ran on sub-pixel coordinates the rounded display values
 * disagree with.
 */
function buildLayoutBox(selector: string, element: Element): LayoutBox {
  const rect = element.getBoundingClientRect()
  const style = getComputedStyle(element)
  return {
    selector,
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    visibility: toVisibility(style.visibility),
    display: style.display,
    zIndex: normalizeZIndex(style.zIndex),
  }
}

/**
 * jsdom's `getComputedStyle().zIndex` returns `''` for an element with no explicit z-index, instead
 * of the CSS initial value `'auto'` a real browser gives for the same element (confirmed directly —
 * see measure-layout.test.ts). `''` doesn't mean anything different from "no explicit z-index," so
 * it is normalized to `'auto'` here rather than passed through as one DOM implementation's
 * idiosyncrasy. This is a no-op in a real browser, which is what actually replays a recording.
 */
function normalizeZIndex(zIndex: string): string {
  return zIndex === '' ? 'auto' : zIndex
}

/**
 * `getComputedStyle().visibility` can also resolve to `'collapse'`, which the contract's
 * `'visible' | 'hidden'` union has no room for. `collapse` only carries a distinct meaning for table
 * rows, columns and row/column groups — it removes them from the table's layout — and visually the
 * content is not shown, which is exactly the question this field exists to answer. So it folds into
 * `'hidden'`, the closer of the two available values, as a deliberate mapping rather than a silent
 * default. Anything that is not literally `'visible'` maps to `'hidden'`, which keeps the mapping
 * total (no third case to maintain if the CSSOM ever grows another visibility keyword).
 */
function toVisibility(computed: string): 'visible' | 'hidden' {
  return computed === 'visible' ? 'visible' : 'hidden'
}

/**
 * Pairwise overlap over every box, reported only when the pair's z-indices differ.
 *
 * Zero-area boxes (`width` or `height` of 0 — a collapsed element, or one that never got a layout
 * box) are excluded from consideration up front. They cannot intersect anything by definition, and
 * leaving that to fall out of the arithmetic below — it would, an empty box always contributes a
 * zero-width or zero-height overlap — would make the guarantee incidental instead of stated.
 */
function computeOverlaps(boxes: LayoutBox[]): LayoutResult['overlaps'] {
  const overlaps: LayoutResult['overlaps'] = []
  const candidates = boxes.filter((box) => box.width > 0 && box.height > 0)

  for (let i = 0; i < candidates.length; i += 1) {
    const a = candidates[i]
    if (!a) continue

    for (let j = i + 1; j < candidates.length; j += 1) {
      const b = candidates[j]
      if (!b) continue

      const overlapArea = intersectionArea(a, b)
      if (overlapArea <= 0) continue

      const rankA = zIndexRank(a.zIndex)
      const rankB = zIndexRank(b.zIndex)
      // Equal z-index (including 'auto' vs 'auto', see zIndexRank) carries no ordering signal, so no
      // pair is reported for it. This is the one case this function is allowed to drop a pair for.
      if (rankA === rankB) continue

      const [above, below] = rankA > rankB ? [a, b] : [b, a]
      overlaps.push({ above: above.selector, below: below.selector, overlapArea: Math.round(overlapArea) })
    }
  }

  return overlaps
}

/** Axis-aligned intersection area of two boxes. Never negative. */
function intersectionArea(
  a: Pick<LayoutBox, 'x' | 'y' | 'width' | 'height'>,
  b: Pick<LayoutBox, 'x' | 'y' | 'width' | 'height'>,
): number {
  const overlapWidth = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const overlapHeight = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return overlapWidth * overlapHeight
}

/**
 * A total ordering over CSS `z-index` values, including `'auto'`.
 *
 * `getComputedStyle().zIndex` resolves to `'auto'` or an integer string — never anything else once
 * the cascade has resolved keywords like `inherit`. Both `'auto'` and anything that fails to parse
 * collapse to `0` for comparison purposes.
 *
 * This is a deliberate simplification, not an oversight: in real CSS, `'auto'` means "don't establish
 * a new stacking level here — defer to paint order inside the parent's stacking context," which is
 * not the same thing as an explicit `0`. Getting that rule exactly right needs the full
 * stacking-context tree — every ancestor's position, z-index, transform and opacity up to the root —
 * and `measureLayout` only ever looks at the elements it was asked about, never their ancestors.
 * Given that constraint, mapping `'auto'` to `0` is the least surprising total order available:
 *   - two `'auto'` elements compare equal, so the pair falls out via the equal-z-index rule in
 *     `computeOverlaps` — which is the right outcome, since z-index genuinely carries no ordering
 *     information between them.
 *   - an explicit `z-index: 0` (a common no-op in real stylesheets) compares equal to `'auto'` too,
 *     matching how most designs actually use it.
 *   - anything with a higher or lower explicit z-index still orders exactly as CSS would order it
 *     against a `0`-or-`auto` sibling in the same stacking context.
 * What this does not claim to get right: two elements in *different* stacking contexts, where a
 * numerically smaller z-index can still paint on top because its ancestor's stacking context comes
 * later. That case needs the ancestor chain, which is out of scope for a function that measures the
 * elements it was pointed at, not the page around them.
 */
function zIndexRank(zIndex: string): number {
  if (zIndex === 'auto') return 0
  const parsed = Number(zIndex)
  return Number.isFinite(parsed) ? parsed : 0
}
