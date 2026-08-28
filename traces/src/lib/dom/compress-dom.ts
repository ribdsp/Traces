import type { CompressedDomResult } from '@/types/domain'

/**
 * The agent-legible DOM representation.
 *
 * Full specification: docs/agent-legible-dom.md.
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
 * Why a node earned its place in the output.
 *
 * This is an ordering, not a label, and the ordering is the load-bearing part: when the budget has to
 * clip something, rule-3 text is shed before rule-1 controls. Positional truncation — keep the first
 * N lines — would be simpler and would be wrong, because the interesting element is routinely the
 * deepest one. A disabled submit button under forty layout wrappers is the whole bug; the forty
 * wrappers' decorative labels are not, however early they appear in document order.
 */
const PRIORITY_INTERACTIVE = 1
const PRIORITY_STATEFUL = 2
const PRIORITY_TEXT = 3

/** Rule 1. Matches the inclusion list in docs/agent-legible-dom.md. */
const INTERACTIVE_SELECTOR = 'input, select, textarea, button, a[href], [role], [tabindex], [onclick]'

/** Rule 2 — state a human would read off the screen. */
const STATE_ATTRIBUTES = [
  'disabled',
  'aria-invalid',
  'aria-disabled',
  'hidden',
  'readonly',
  'required',
  'checked',
  'aria-expanded',
] as const

/** Identity attributes rendered tight against the tag, as `input[name=email]`. */
const IDENTITY_ATTRIBUTES = ['name', 'type', 'role'] as const

/** Rendered as `k=v` when present. Order fixed so output is stable across runs. */
const DESCRIPTIVE_ATTRIBUTES = ['placeholder', 'aria-label', 'aria-invalid', 'aria-expanded', 'data-testid'] as const

/**
 * The one class we keep. A single short class matching this is frequently the only clue that a `div`
 * is a validation message; a Tailwind utility list never matches, which is the point.
 */
const SEMANTIC_CLASS_PATTERN = /^(error|warning|invalid|success|danger|alert|hint|help)$/i

/** Per-attribute truncation, from the spec's attribute table. */
const MAX_VALUE_CHARS = 20
const MAX_HREF_CHARS = 40

/**
 * Cap for every other whitelisted attribute, and for `id`.
 *
 * The spec only gives explicit limits for `value` and `href`, but leaving the rest unbounded is a hole
 * in the budget rather than a gap in the spec: `aria-label` and `data-testid` are author-controlled and
 * occasionally hold a whole sentence, and `id` in a generated app can be very long indeed.
 */
const MAX_ATTRIBUTE_CHARS = 40

/** Discarded with their entire subtree: no state, no readable text, unbounded size. */
const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'SVG', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', 'HEAD'])

const TEXT_NODE = 3

type Candidate = {
  element: Element
  priority: number
  /** Document order, so a clipped output still reads top-to-bottom. */
  order: number
}

/** Direct text only. A container's value is its own label, never its descendants' concatenation. */
function directText(element: Element): string {
  let text = ''
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === TEXT_NODE) text += node.textContent ?? ''
  }
  return text.trim().replace(/\s+/g, ' ')
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}...`
}

/**
 * Quote only when the value contains whitespace. `aria-invalid=true` reads fine bare; an unquoted
 * `placeholder=Full name` reads as two separate attributes, which is a misreading the model has no
 * way to detect.
 */
function renderAttribute(name: string, value: string): string {
  return /\s/.test(value) ? `${name}="${value}"` : `${name}=${value}`
}

function semanticClass(element: Element): string | null {
  const classes = Array.from(element.classList)
  const match = classes.find((name) => SEMANTIC_CLASS_PATTERN.test(name))
  return match ?? null
}

/**
 * Tag-name checks rather than `instanceof`: a replayed recording lives inside rrweb's iframe, which
 * has its own realm and therefore its own `HTMLSelectElement` constructor, so `instanceof` against
 * this frame's constructor can silently return false for a real `<select>`. Same reasoning as
 * lib/bisect/predicate.ts.
 */
function isSelect(element: Element): boolean {
  return element.tagName === 'SELECT'
}

/**
 * Which elements get a `value=` part.
 *
 * Checkboxes and radios are excluded even though they are `INPUT`s, because their `value` is the
 * submission payload, not the state. An unchecked box still reports `value="on"` — the browser default
 * — so rendering it printed `value="on"` under every checkbox in the tree, which reads as "this is on"
 * and is the opposite of the truth half the time. What a model needs from a checkbox is `[checked]`,
 * below.
 */
function hasEditableValue(element: Element): boolean {
  if (element.tagName === 'TEXTAREA') return true
  if (element.tagName !== 'INPUT') return false
  const type = (element.getAttribute('type') ?? '').toLowerCase()
  return type !== 'checkbox' && type !== 'radio'
}

/**
 * Checkedness, live property first — the same reasoning as `readValue`, and for a sharper reason.
 *
 * The attribute is the page's initial markup; the property is what is on screen. A box that ships
 * `checked` and is then unticked by the user has attribute `true` and property `false`, and the
 * property is the one the user is looking at.
 *
 * Measured against a real rrweb replay: when a recording sets `.checked = true`, the replay restores
 * **both** the property and a `checked=""` attribute, so either read happens to work on the replay
 * path. The property is still what this reads, because "either works" is a fact about one rrweb
 * version and "the property is the state" is a fact about HTML.
 */
function isChecked(element: Element): boolean {
  const raw = (element as unknown as Record<string, unknown>).checked
  if (typeof raw === 'boolean') return raw
  return element.hasAttribute('checked')
}

/** Live property first: `input.value` and `[value]` diverge the instant a user types. */
function readValue(element: Element): string {
  const raw = (element as unknown as Record<string, unknown>).value
  if (typeof raw === 'string') return raw
  return element.getAttribute('value') ?? ''
}

/**
 * Deliberately does not test for zero size, though the spec lists it. jsdom implements no layout, so
 * every element measures 0×0 under test and a size check would mark the entire tree `[hidden]` —
 * a false statement is worse than a missing annotation. Geometry is `measureLayout`'s job.
 */
function isHidden(element: Element): boolean {
  if (element.hasAttribute('hidden')) return true
  if (typeof getComputedStyle !== 'function') return false
  const style = getComputedStyle(element)
  return style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
}

function classify(element: Element): number | null {
  if (element.matches(INTERACTIVE_SELECTOR)) return PRIORITY_INTERACTIVE
  if (STATE_ATTRIBUTES.some((attribute) => element.hasAttribute(attribute))) return PRIORITY_STATEFUL
  const text = directText(element)
  if (text.length > 0 && text.length <= MAX_TEXT_CHARS) return PRIORITY_TEXT
  return null
}

function collectCandidates(root: Element): Candidate[] {
  const candidates: Candidate[] = []
  let order = 0

  const visit = (element: Element): void => {
    if (SKIPPED_TAGS.has(element.tagName)) return
    order += 1
    if (element !== root) {
      const priority = classify(element)
      if (priority !== null) candidates.push({ element, priority, order })
    }
    for (const child of Array.from(element.children)) visit(child)
  }

  visit(root)
  return candidates
}

/** Rule 4: a structural ancestor survives only because something beneath it did. */
function keptElements(root: Element, candidates: Candidate[]): Set<Element> {
  const kept = new Set<Element>([root])
  for (const candidate of candidates) {
    let cursor: Element | null = candidate.element
    while (cursor !== null && cursor !== root && !kept.has(cursor)) {
      kept.add(cursor)
      cursor = cursor.parentElement
    }
  }
  return kept
}

function renderLine(element: Element, indent: number, isRoot: boolean): string {
  let head = element.tagName.toLowerCase()

  const id = element.getAttribute('id')
  if (id !== null && id !== '') head += `#${truncate(id, MAX_ATTRIBUTE_CHARS)}`

  const className = semanticClass(element)
  if (className !== null) head += `.${className}`

  for (const attribute of IDENTITY_ATTRIBUTES) {
    const value = element.getAttribute(attribute)
    if (value !== null && value !== '') head += `[${attribute}=${truncate(value, MAX_ATTRIBUTE_CHARS)}]`
  }

  const parts = [head]

  const text = directText(element)
  if (text.length > 0) parts.push(`"${truncate(text, MAX_TEXT_CHARS)}"`)

  if (hasEditableValue(element)) parts.push(`value="${truncate(readValue(element), MAX_VALUE_CHARS)}"`)

  const href = element.getAttribute('href')
  if (href !== null && href !== '') parts.push(`href="${truncate(href, MAX_HREF_CHARS)}"`)

  for (const attribute of DESCRIPTIVE_ATTRIBUTES) {
    const value = element.getAttribute(attribute)
    if (value !== null && value !== '') parts.push(renderAttribute(attribute, truncate(value, MAX_ATTRIBUTE_CHARS)))
  }

  // Stated outright rather than left to inference — see the spec's "special annotations".
  if (isSelect(element) && element.querySelectorAll('option').length === 0) parts.push('[empty options: 0]')
  // The spec's attribute table lists `checked`, `required` and `readonly` as included state, and they
  // were being classified on but never rendered — so `classify` promoted a required field to
  // PRIORITY_STATEFUL, spent a line on it, and then didn't say why it mattered. Rendered as bare
  // annotations rather than `required=""`: they are boolean attributes, and the empty string is noise.
  // `required` is not decoration on this project's own demo recording — a required `<select>` whose
  // options were wiped is precisely the bug, and unstated it looks like an ordinary empty dropdown.
  if (isChecked(element)) parts.push('[checked]')
  if (element.hasAttribute('required')) parts.push('[required]')
  if (element.hasAttribute('readonly')) parts.push('[readonly]')
  if (element.hasAttribute('disabled')) parts.push('[DISABLED]')
  if (isHidden(element)) parts.push('[hidden]')
  // On the scope root only. Repeating it per line costs more tokens than it conveys.
  if (isRoot) parts.push('[visible]')

  return `${'  '.repeat(indent)}${parts.join(' ')}`
}

/**
 * A structural ancestor with nothing of its own to say is collapsed: its children render at its
 * indent and it gets no line. This is where the ratio comes from on a real app — a chain of forty
 * anonymous wrappers becomes zero lines, not forty.
 */
function isCollapsible(element: Element, isCandidate: boolean, isRoot: boolean): boolean {
  if (isRoot || isCandidate) return false
  const id = element.getAttribute('id')
  if (id !== null && id !== '') return false
  return semanticClass(element) === null
}

type Rendered = { dom: string; flattened: boolean }

function render(root: Element, candidates: Candidate[], withNote: boolean): Rendered {
  const kept = keptElements(root, candidates)
  const candidateElements = new Set(candidates.map((candidate) => candidate.element))
  const lines: string[] = []
  let flattened = false

  const walk = (element: Element, depth: number): void => {
    const isRoot = element === root
    const collapsible = isCollapsible(element, candidateElements.has(element), isRoot)
    let nextDepth = depth

    if (!collapsible) {
      // Past MAX_DEPTH we stop indenting rather than stop emitting: depth flattens the remainder,
      // it never discards it. Losing the nesting is a smaller lie than losing the element.
      if (depth > MAX_DEPTH) flattened = true
      lines.push(renderLine(element, Math.min(depth, MAX_DEPTH), isRoot))
      nextDepth = depth + 1
    }

    for (const child of Array.from(element.children)) {
      if (kept.has(child)) walk(child, nextDepth)
    }
  }

  walk(root, 0)
  if (withNote) lines.push(TRUNCATION_NOTE)
  return { dom: lines.join('\n'), flattened }
}

function countLines(dom: string): number {
  return dom === '' ? 0 : dom.split('\n').length
}

/** One included node, paired with the text `compressDom` would have rendered for it. */
export type IncludedNode = { element: Element; text: string }

/**
 * The nodes the inclusion filter keeps, in document order.
 *
 * Exported for `diffDom`, which has to compare *exactly* the set `compressDom` renders. If the two
 * disagree, an agent told "nothing changed" by `diff_dom` and then shown a visibly different element
 * by `get_dom_at` has no way to tell which tool lied — so they share one filter rather than two
 * implementations that drift.
 */
export function collectIncludedNodes(root: Element): IncludedNode[] {
  return collectCandidates(root).map((candidate) => ({
    element: candidate.element,
    text: directText(candidate.element),
  }))
}

function fitsBudget(dom: string): boolean {
  return dom.length <= MAX_CHARS && countLines(dom) <= MAX_LINES
}

/**
 * Last-resort clamp, so the budget is an invariant rather than a proof obligation.
 *
 * With the per-attribute caps above in place this is unreachable through the public API: every part of
 * a line — tag, id, semantic class, identity attributes, text, value, href, descriptive attributes — is
 * individually bounded, so no single line can approach MAX_CHARS. It is kept anyway, and the reason is
 * the honest one: without it, "the output fits the budget" is a conclusion you reach by checking five
 * separate truncation sites and trusting that a sixth is never added. With it, the guarantee lives in
 * one place. Room is reserved for the note first, because a clipped tree with no instruction is the one
 * output an agent cannot recover from.
 */
function clampToBudget(dom: string): { dom: string; clamped: boolean } {
  if (fitsBudget(dom)) return { dom, clamped: false }

  const lines = dom.split('\n')
  const limited = lines.length > MAX_LINES ? lines.slice(0, MAX_LINES - 1) : lines
  let text = limited.join('\n')

  if (text.length > MAX_CHARS) {
    text = text.slice(0, Math.max(0, MAX_CHARS - TRUNCATION_NOTE.length - 1))
  }
  if (!text.endsWith(TRUNCATION_NOTE)) text = `${text}\n${TRUNCATION_NOTE}`

  return { dom: text, clamped: true }
}

/**
 * Compress a DOM subtree into the agent-legible representation.
 *
 * Specification and budget: docs/agent-legible-dom.md.
 *
 * Inclusion rules, applied in priority order (see the PRIORITY_ constants above):
 *   1. interactive elements — input, select, textarea, button, a[href], [role], [tabindex]
 *   2. state-bearing elements — disabled, aria-invalid, hidden, readonly, required, checked, ...
 *   3. elements with their own short readable text, truncated to MAX_TEXT_CHARS
 *   4. structural ancestors of the above, and only as far as needed
 *
 * Everything else is discarded with its whole subtree. Dropping a wrapper is cheap; dropping a
 * wrapper *and its four hundred descendants* is where the compression ratio actually comes from.
 *
 * When the result exceeds the budget, the search below keeps the largest prefix of the
 * priority-sorted candidate list that still fits, then renders those survivors back in document
 * order — so a clipped tree still reads top-to-bottom, but what got clipped is the least useful
 * thing rather than the last thing. `truncated` is reported so the response can tell the agent to
 * narrow its scope, which is a thing an agent can act on.
 */
export function compressDom(options: CompressOptions): CompressedDomResult {
  const root = options.root ?? (typeof document === 'undefined' ? null : document.body)
  if (root === null) {
    throw new Error('compressDom: no root element to compress. Pass `root`, or call this with a document available.')
  }

  const sourceCharCount = root.outerHTML.length
  const candidates = collectCandidates(root).sort(
    (left, right) => left.priority - right.priority || left.order - right.order,
  )

  let rendered = render(root, candidates, false)
  let truncated = false

  if (!fitsBudget(rendered.dom)) {
    truncated = true
    // Largest prefix of the priority-sorted candidates that still fits. `low` reaching 0 means even the
    // scope root's own line was too big, which the per-attribute caps make unreachable — `clampToBudget`
    // is what turns that reasoning into a guarantee.
    let low = 0
    let high = candidates.length
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (fitsBudget(render(root, candidates.slice(0, mid), true).dom)) low = mid
      else high = mid - 1
    }
    rendered = render(root, candidates.slice(0, low), true)
  }

  const clamped = clampToBudget(rendered.dom)

  return {
    atMs: options.atMs,
    dom: clamped.dom,
    lineCount: countLines(clamped.dom),
    charCount: clamped.dom.length,
    truncated: truncated || rendered.flattened || clamped.clamped,
    sourceCharCount,
  }
}
