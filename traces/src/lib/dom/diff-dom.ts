import type { DomDiffChange, DomDiffResult } from '@/types/domain'
import { ATTRIBUTE_WHITELIST, collectIncludedNodes } from './compress-dom'

/** `diff_dom` never returns more changes than this. */
export const MAX_CHANGES = 30

/** One moment of the recording, already positioned by the caller. */
export type DomSnapshot = { document: Document; atMs: number }

/**
 * Ranking used only when the cap bites. Lower survives.
 *
 * A disabled button appearing and forty paragraphs of copy being retranslated are both "changes", and
 * exactly one of them explains a bug. Truncating in document order would routinely drop the button,
 * because the interesting element is usually late in the form.
 */
const RANK_INTERACTIVE_STRUCTURE = 1
const RANK_INTERACTIVE_ATTRIBUTE = 2
const RANK_STRUCTURE = 3
const RANK_ATTRIBUTE = 4
const RANK_TEXT = 5

const INTERACTIVE_SELECTOR = 'input, select, textarea, button, a[href], [role], [tabindex]'

type Entry = { selector: string; element: Element; text: string }
type RankedChange = { change: DomDiffChange; rank: number }

function rootOf(snapshot: DomSnapshot): Element {
  return snapshot.document.body ?? snapshot.document.documentElement
}

function isInteractive(element: Element): boolean {
  return element.matches(INTERACTIVE_SELECTOR)
}

/** How many of `parent`'s direct children this selector matches. Used to reject ambiguous segments. */
function siblingMatchCount(element: Element, selector: string): number {
  const parent = element.parentElement
  if (parent === null) return 1
  return Array.from(parent.children).filter((child) => child.matches(selector)).length
}

function positionAmongSameTag(element: Element): number {
  const parent = element.parentElement
  if (parent === null) return 1
  const tag = element.tagName
  let position = 0
  for (const child of Array.from(parent.children)) {
    if (child.tagName === tag) position += 1
    if (child === element) return position
  }
  return position
}

/**
 * An id safe to write as `#id`. Anything else goes through `[id="..."]`, which needs no escaping.
 *
 * `CSS.escape` would be the obvious tool and is deliberately not used: it is absent in jsdom, and it
 * lives on the *global* `CSS` object, so inside rrweb's iframe realm it is one more thing that can be
 * undefined at exactly the wrong moment.
 */
const PLAIN_ID_PATTERN = /^[A-Za-z_-][\w-]*$/

function idSelector(id: string): string {
  return PLAIN_ID_PATTERN.test(id) ? `#${id}` : `[id="${id}"]`
}

/**
 * One path segment. Every branch is verified unique among the element's siblings before it is used —
 * an ambiguous segment is worse than a positional one, because `input[name=ship]` silently resolves
 * to the *first* radio in a group and the diff then reports a change on the wrong element.
 */
function segmentFor(element: Element, root: Element): string {
  const tag = element.tagName.toLowerCase()

  const id = element.getAttribute('id')
  if (id !== null && id !== '') {
    const selector = idSelector(id)
    if (root.querySelectorAll(selector).length === 1) return selector
  }

  for (const attribute of ['data-testid', 'name'] as const) {
    const value = element.getAttribute(attribute)
    if (value === null || value === '') continue
    const candidate = `${tag}[${attribute}="${value}"]`
    if (siblingMatchCount(element, candidate) === 1) return candidate
  }

  return `${tag}:nth-of-type(${positionAmongSameTag(element)})`
}

/**
 * A selector stable enough to name the same element at two different moments, and valid enough to
 * hand back to the agent — it goes into `annotate` and `measure_layout` next, so a decorative
 * pseudo-selector would fail one step later, somewhere that looks unrelated.
 *
 * Climbing stops at an `id`, which is document-unique by definition, so a React-regenerated wrapper
 * above it cannot perturb the path.
 */
function stableSelector(element: Element, root: Element): string {
  const segments: string[] = []
  let cursor: Element | null = element

  while (cursor !== null && cursor !== root) {
    const segment = segmentFor(cursor, root)
    segments.unshift(segment)
    if (segment.startsWith('#')) break
    cursor = cursor.parentElement
  }

  return segments.length === 0 ? root.tagName.toLowerCase() : segments.join(' > ')
}

function indexSnapshot(snapshot: DomSnapshot): Map<string, Entry> {
  const root = rootOf(snapshot)
  const entries = new Map<string, Entry>()
  for (const node of collectIncludedNodes(root)) {
    const selector = stableSelector(node.element, root)
    // First occurrence wins. Reaching here means two nodes produced one selector despite the
    // uniqueness checks above, which should be impossible; silently overwriting would hide it.
    if (!entries.has(selector)) entries.set(selector, { selector, element: node.element, text: node.text })
  }
  return entries
}

/** Whitelisted attributes only — the same set compressDom shows, so the diff can't cite invisible state. */
function attributesOf(element: Element): Map<string, string> {
  const attributes = new Map<string, string>()
  for (const name of ATTRIBUTE_WHITELIST) {
    const value = element.getAttribute(name)
    if (value !== null) attributes.set(name, value)
  }
  return attributes
}

function describe(entry: Entry): string {
  const attributes = Array.from(attributesOf(entry.element), ([name, value]) => `${name}="${value}"`)
  const tag = entry.element.tagName.toLowerCase()
  const text = entry.text === '' ? '' : ` "${entry.text}"`
  return `<${[tag, ...attributes].join(' ')}>${text}`
}

function compareAttributes(selector: string, before: Entry, after: Entry, into: RankedChange[]): void {
  const beforeAttributes = attributesOf(before.element)
  const afterAttributes = attributesOf(after.element)
  const rank = isInteractive(after.element) ? RANK_INTERACTIVE_ATTRIBUTE : RANK_ATTRIBUTE

  for (const name of ATTRIBUTE_WHITELIST) {
    const had = beforeAttributes.has(name)
    const has = afterAttributes.has(name)
    if (!had && !has) continue
    const was = beforeAttributes.get(name)
    const now = afterAttributes.get(name)
    if (was === now) continue
    // The attribute name is repeated on both sides deliberately: DomDiffChange has no `attribute`
    // field, and an appearing or vanishing attribute would otherwise be an unlabelled empty string.
    into.push({
      rank,
      change: {
        kind: 'attributeChanged',
        selector,
        before: had ? `${name}="${was}"` : `${name} (absent)`,
        after: has ? `${name}="${now}"` : `${name} (absent)`,
      },
    })
  }
}

/**
 * Refuse to diff a document against itself.
 *
 * This is the guard that stops the worst bug this module can have, and it is not hypothetical — it was
 * measured against a real rrweb replay. The Replayer owns **one** iframe and mutates that one document
 * in place when it seeks, so `engine.mirrorDocument()` returns the *same object identity* at every
 * moment of the recording. A caller that seeks to 1400 ms, keeps the returned `Document`, then seeks to
 * 2600 ms and keeps that one, is holding two references to a single document — and both of them show
 * the state at 2600 ms.
 *
 * What that produced, on a recording where six `<option>` elements were removed, `aria-invalid` flipped
 * to `true` and an error `<div>` appeared between the two moments: **zero changes**. Not an error, not a
 * warning — a clean, confident, wrong answer, of exactly the shape an agent would relay to the user as
 * "nothing changed there, look elsewhere". Cloning the earlier document first gave the correct nine
 * changes.
 *
 * So the fix cannot be a fallback or a best guess; there is genuinely no information left to recover
 * once both sides point at the same object. It has to be an error, and the message has to name the
 * remedy, because the caller is a tool wrapper in another area of the codebase and whoever reads this
 * error will be reading it from a stack trace with no context.
 *
 * `document.cloneNode(true)` is the clone that works, and it is the only one that does: `importNode`
 * refuses a document node outright (`NotSupportedError`, measured, in both realms). The deep clone
 * carries `<option>` children and live `.value` properties across — verified: six options and
 * a live input `value` on the clone, still six after the Replayer seeked the live document down to
 * zero — and the clone is inert, because nothing reflows a detached document.
 */
function assertDistinctDocuments(before: DomSnapshot, after: DomSnapshot): void {
  if (before.document !== after.document) return
  throw new Error(
    `diffDom: both snapshots are the same Document object (${before.atMs}ms and ${after.atMs}ms), so ` +
      'the "before" side already shows the "after" state and every diff would come back empty. ' +
      'The replay engine reuses one document across seeks — snapshot the earlier moment with ' +
      '`engine.mirrorDocument().cloneNode(true) as Document` before seeking to the later one.',
  )
}

/**
 * What changed between two moments, as a short list.
 *
 * Compare two *compressed* trees, not two raw ones. A raw diff of a React app is mostly reordered
 * class strings and regenerated ids — technically accurate, useless to a model, and expensive. Both
 * sides run through `collectIncludedNodes`, the same inclusion filter `compressDom` renders, so a
 * change this reports is always a change the agent can go and look at.
 *
 * The caller positions the replay at both moments and passes the resulting documents; this function
 * does no replaying and holds no engine reference, which is what keeps it unit-testable.
 *
 * **The caller must clone the earlier document before seeking away from it.** See the guard below for
 * what happens otherwise.
 */
export function diffDom(before: DomSnapshot, after: DomSnapshot): DomDiffResult {
  assertDistinctDocuments(before, after)
  const beforeEntries = indexSnapshot(before)
  const afterEntries = indexSnapshot(after)
  const ranked: RankedChange[] = []

  // After-document order first, so added and changed entries read top-to-bottom.
  for (const [selector, entry] of afterEntries) {
    const previous = beforeEntries.get(selector)
    if (previous === undefined) {
      const rank = isInteractive(entry.element) ? RANK_INTERACTIVE_STRUCTURE : RANK_STRUCTURE
      ranked.push({ rank, change: { kind: 'added', selector, after: describe(entry) } })
      continue
    }
    compareAttributes(selector, previous, entry, ranked)
    if (previous.text !== entry.text) {
      ranked.push({ rank: RANK_TEXT, change: { kind: 'textChanged', selector, before: previous.text, after: entry.text } })
    }
  }

  for (const [selector, entry] of beforeEntries) {
    if (afterEntries.has(selector)) continue
    const rank = isInteractive(entry.element) ? RANK_INTERACTIVE_STRUCTURE : RANK_STRUCTURE
    ranked.push({ rank, change: { kind: 'removed', selector, before: describe(entry) } })
  }

  const truncated = ranked.length > MAX_CHANGES
  if (!truncated) {
    return { fromMs: before.atMs, toMs: after.atMs, changes: ranked.map((entry) => entry.change), truncated }
  }

  // Rank to decide *what* survives, then restore emission order to decide how it reads. Array#sort is
  // stable, so `position` is only a tiebreaker inside a rank and the second sort undoes the first.
  const withPosition = ranked.map((entry, position) => ({ ...entry, position }))
  const survivors = withPosition
    .sort((left, right) => left.rank - right.rank || left.position - right.position)
    .slice(0, MAX_CHANGES)
    .sort((left, right) => left.position - right.position)

  return {
    fromMs: before.atMs,
    toMs: after.atMs,
    changes: survivors.map((entry) => entry.change),
    truncated,
  }
}
