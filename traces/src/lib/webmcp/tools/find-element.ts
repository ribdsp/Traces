import { bisect } from '@/lib/bisect/bisect'
import { validateSelector } from '@/lib/bisect/predicate'
import type { ReplayEngine } from '@/lib/replay/replay-engine'
import { sessionState } from '@/lib/store/session'
import { type ToolDefinition, json, toolError } from '../tool-types'
import { currentEngine, currentRecording, documentAt, oneLine, optionalNumber, optionalString, restorePlayhead } from './tool-context'

/**
 * 'find_element' — see docs/tools.md#3-find_element for the full contract.
 *
 * **This tool has no pure-lib backing, and that is a gap in the file plan rather than a design
 * choice.** Everything below `execute` — the selector strategy especially — is logic that belongs in
 * `lib/dom/find-element.ts` with its own tests, next to `compress-dom` and `diff-dom` which already
 * solve half of the same problem. It is written here because the demo chain runs
 * find_element → bisect and there is nothing one layer down to call. See the final report; the
 * exported functions below are deliberately pure and take an explicit root so that moving them is a
 * copy, not a rewrite.
 *
 * The single most consequential decision in this file is that **the returned selector must never
 * contain a positional step.** The agent feeds it straight into `bisect`, which re-resolves it at half
 * a dozen *other* timestamps; `nth-child(3)` resolves to a different element the moment a sibling is
 * inserted above it, and the bisect then reports a confident transition for an element nobody asked
 * about. So the ranking is id → data-testid → name → a short path of stable attributes, and when no
 * unique stable selector exists the response says so instead of manufacturing one.
 */

/** Response budget, from CONTRIBUTING.md § Every tool response has a budget. */
const MATCH_LIMIT = 5
/** Text snippets are page content: collapsed, capped, never HTML. */
const SNIPPET_CHARS = 80
/** How far up the tree to look for an `id`/`data-testid` to anchor a selector to. */
const ANCHOR_SEARCH_DEPTH = 6
/** A path longer than this stops being a selector and starts being a description of the tree. */
const MAX_PATH_SEGMENTS = 5
/**
 * Lifetime search precision. Coarser than `bisect`'s own default because this is orientation — "the
 * element appears about a third of the way in" — and two searches per match at 250 ms would triple the
 * replay cost of a call an agent makes early and often.
 */
const LIFETIME_PRECISION_MS = 500

/**
 * Attributes allowed in a selector, in preference order. Every one of them is authored rather than
 * generated, which is what makes it survive a re-render; `class` is excluded (utility classes churn),
 * and so is anything positional.
 */
const PATH_ATTRIBUTES = ['data-testid', 'name', 'type', 'role', 'aria-label', 'placeholder'] as const

/** Safe to write as `#id`. Anything else goes through `[id="..."]`, which needs no escaping. */
const PLAIN_ID_PATTERN = /^[A-Za-z_-][\w-]*$/

/**
 * An attribute value we are willing to interpolate into a selector.
 *
 * Quotes and backslashes are excluded rather than escaped: this string is built from page content,
 * handed to the model, and then handed back to `querySelector` by a later tool call, and an escaping
 * scheme that has to survive that round trip is a bug waiting to happen. Skipping the attribute costs
 * one candidate; getting it wrong costs a selector that silently matches nothing.
 */
const SAFE_ATTRIBUTE_VALUE = /^[^"\\\n\r]{1,80}$/

/** ARIA role names only, so the value can be interpolated into `[role="..."]` without escaping. */
const ROLE_PATTERN = /^[a-zA-Z-]{1,30}$/

/**
 * Implicit roles, so `role: "button"` finds a `<button>` and not only an element that spells its role
 * out. Deliberately short: the full HTML-AAM mapping is large, context-dependent, and does not belong
 * in a tool wrapper. These are the ones a checkout form is made of.
 */
const IMPLICIT_ROLE_SELECTORS: Record<string, string> = {
  button: 'button, input[type=button], input[type=submit], input[type=reset]',
  link: 'a[href]',
  textbox:
    'textarea, input:not([type]), input[type=text], input[type=email], input[type=search], input[type=tel], input[type=url], input[type=password]',
  combobox: 'select',
  listbox: 'select[multiple]',
  option: 'option',
  checkbox: 'input[type=checkbox]',
  radio: 'input[type=radio]',
  heading: 'h1, h2, h3, h4, h5, h6',
  img: 'img',
  alert: '[role=alert]',
}

/** Never a match in its own right: no readable text of its own, or not part of the rendered page. */
const EXCLUDED_TAGS = new Set(['HTML', 'HEAD', 'BODY', 'SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'TEMPLATE', 'NOSCRIPT'])

export type StableSelector = {
  selector: string
  /** False when the selector matches more than one element, so a later bisect resolves the first. */
  unique: boolean
}

function idSelector(id: string): string {
  return PLAIN_ID_PATTERN.test(id) ? `#${id}` : `[id="${id}"]`
}

function safeAttribute(element: Element, name: string): string | null {
  const value = element.getAttribute(name)
  if (value === null || value === '') return null
  return SAFE_ATTRIBUTE_VALUE.test(value) ? value : null
}

/** `querySelectorAll().length`, with a malformed selector counted as zero matches rather than thrown. */
function countMatches(root: Document | Element, selector: string): number {
  try {
    return root.querySelectorAll(selector).length
  } catch {
    return 0
  }
}

/**
 * One path segment: the tag, plus at most one stable attribute. Never positional.
 *
 * An `id` short-circuits the whole thing — it is document-unique by definition, so a path anchored on
 * one cannot be perturbed by anything above it.
 */
function segmentFor(element: Element): string {
  const tag = element.tagName.toLowerCase()

  const id = safeAttribute(element, 'id')
  if (id !== null) return idSelector(id)

  for (const attribute of PATH_ATTRIBUTES) {
    const value = safeAttribute(element, attribute)
    if (value !== null) return `${tag}[${attribute}="${value}"]`
  }

  return tag
}

function isIdAnchored(segment: string): boolean {
  return segment.startsWith('#') || segment.startsWith('[id=')
}

/** Single-segment selectors worth trying before any path, most stable first. */
function identityCandidates(element: Element): string[] {
  const tag = element.tagName.toLowerCase()
  const candidates: string[] = []

  const id = safeAttribute(element, 'id')
  if (id !== null) candidates.push(idSelector(id))

  const testId = safeAttribute(element, 'data-testid')
  if (testId !== null) candidates.push(`${tag}[data-testid="${testId}"]`)

  const name = safeAttribute(element, 'name')
  if (name !== null) {
    candidates.push(`${tag}[name="${name}"]`)
    // Radio groups share a name, so the type is what separates them — and both halves are authored.
    const type = safeAttribute(element, 'type')
    if (type !== null) candidates.push(`${tag}[name="${name}"][type="${type}"]`)
  }

  const label = safeAttribute(element, 'aria-label')
  if (label !== null) candidates.push(`${tag}[aria-label="${label}"]`)

  const role = safeAttribute(element, 'role')
  if (role !== null) candidates.push(`${tag}[role="${role}"]`)

  return candidates
}

/**
 * A selector that identifies `element` and keeps identifying it as the recording plays.
 *
 * Four strategies, in order, each returning as soon as it produces something document-unique:
 *
 *   1. an identity attribute on the element itself — `#province`, `select[name="province"]`
 *   2. the element hung off the nearest anchored ancestor with a descendant combinator —
 *      `#checkout select[name="province"]`. A descendant combinator rather than a child one on purpose:
 *      it survives a wrapper `<div>` appearing between the two, which is exactly what a React
 *      re-render does.
 *   3. a contiguous child path of stable segments, shortest first
 *   4. failing all of that, the longest path built, with `unique: false` — an honest ambiguous selector
 *      beats an `nth-child` that is unique now and wrong later
 *
 * Pure, and takes its root explicitly, so it moves to `lib/` unchanged.
 */
export function stableSelectorFor(element: Element, root: Document | Element): StableSelector {
  for (const candidate of identityCandidates(element)) {
    if (countMatches(root, candidate) === 1) return { selector: candidate, unique: true }
  }

  const ownSegment = segmentFor(element)

  let ancestor = element.parentElement
  let depth = 0
  while (ancestor !== null && depth < ANCHOR_SEARCH_DEPTH) {
    const anchorId = safeAttribute(ancestor, 'id')
    const anchorTestId = safeAttribute(ancestor, 'data-testid')
    const anchor =
      anchorId !== null
        ? idSelector(anchorId)
        : anchorTestId !== null
          ? `${ancestor.tagName.toLowerCase()}[data-testid="${anchorTestId}"]`
          : null

    if (anchor !== null && countMatches(root, anchor) === 1) {
      const candidate = `${anchor} ${ownSegment}`
      if (countMatches(root, candidate) === 1) return { selector: candidate, unique: true }
    }

    ancestor = ancestor.parentElement
    depth += 1
  }

  const segments: string[] = []
  let cursor: Element | null = element
  while (cursor !== null && !EXCLUDED_TAGS.has(cursor.tagName) && segments.length < MAX_PATH_SEGMENTS) {
    const segment = segmentFor(cursor)
    segments.unshift(segment)
    const path = segments.join(' > ')
    if (countMatches(root, path) === 1) return { selector: path, unique: true }
    if (isIdAnchored(segment)) break
    cursor = cursor.parentElement
  }

  const fallback = segments.length > 0 ? segments.join(' > ') : element.tagName.toLowerCase()
  return { selector: fallback, unique: countMatches(root, fallback) === 1 }
}

export type FindCriteria = { selector?: string; role?: string; text?: string }

/** One entry of the response. No frozen type covers this — see the note at the top of the file. */
type FoundMatch = {
  selector: string
  tagName: string
  /** Page text, collapsed and capped. Never markup. */
  textSnippet: string
  firstSeenMs: number | null
  lastSeenMs: number | null
  selectorMatchesMultiple?: boolean
  selectorNote?: string
}

/**
 * Elements matching every criterion given, in document order.
 *
 * Text matching keeps only the *innermost* match: a `<div>` wrapping the whole form technically
 * contains the word "Pay", and returning it alongside the button would spend the five-match budget on
 * five ancestors of one element. Pure and root-explicit, like `stableSelectorFor`.
 */
export function findCandidates(root: Document, criteria: FindCriteria): Element[] {
  const base = criteria.selector ?? (criteria.role === undefined ? '*' : roleSelector(criteria.role))

  let elements: Element[]
  try {
    elements = Array.from(root.querySelectorAll(base))
  } catch {
    return []
  }

  elements = elements.filter((element) => !EXCLUDED_TAGS.has(element.tagName))

  // Applied as a filter too, so `{ selector, role }` together mean "and", not "or".
  if (criteria.selector !== undefined && criteria.role !== undefined) {
    const wanted = roleSelector(criteria.role)
    elements = elements.filter((element) => {
      try {
        return element.matches(wanted)
      } catch {
        return false
      }
    })
  }

  const needle = criteria.text?.toLowerCase()
  if (needle !== undefined) {
    const withText = elements.filter((element) => (element.textContent ?? '').toLowerCase().includes(needle))
    elements = withText.filter((element) => !withText.some((other) => other !== element && element.contains(other)))
  }

  return elements
}

function roleSelector(role: string): string {
  const implicit = IMPLICIT_ROLE_SELECTORS[role.toLowerCase()]
  const explicit = `[role="${role}"]`
  return implicit === undefined ? explicit : `${explicit}, ${implicit}`
}

/**
 * When the element first appears and when it goes away, as real numbers.
 *
 * Two bisects rather than a scan: `{ kind: 'exists' }` is monotonic in each direction, so appearance is
 * a search for the first instant the selector resolves and disappearance is a search for the first
 * instant it stops resolving. Guessing these — or reporting the timestamp we happened to query at —
 * would put a fabricated number next to five real ones, and the agent has no way to tell which is
 * which.
 */
async function lifetimeOf(
  engine: ReplayEngine,
  selector: string,
  durationMs: number,
): Promise<{ firstSeenMs: number | null; lastSeenMs: number | null }> {
  const exists = async (atMs: number): Promise<boolean> => {
    await engine.gotoTime(atMs)
    try {
      return engine.mirrorDocument().querySelector(selector) !== null
    } catch {
      return false
    }
  }

  const appeared = await bisect({
    from: 0,
    to: durationMs,
    precisionMs: LIFETIME_PRECISION_MS,
    probe: async (atMs) => {
      const present = await exists(atMs)
      return { result: present, elementMissing: !present }
    },
  })

  if (appeared.firstTrue === null) return { firstSeenMs: null, lastSeenMs: null }

  const vanished = await bisect({
    from: appeared.firstTrue,
    to: durationMs,
    precisionMs: LIFETIME_PRECISION_MS,
    probe: async (atMs) => {
      const present = await exists(atMs)
      return { result: !present, elementMissing: !present }
    },
  })

  return {
    firstSeenMs: appeared.firstTrue,
    // Still present at the end of the recording is the common case, and `durationMs` is the honest
    // answer for it — not `null`, which would read as "never seen".
    lastSeenMs: vanished.firstTrue === null ? durationMs : vanished.firstTrue,
  }
}

export const findElementTool: ToolDefinition = {
  name: 'find_element',
  description: [
    'Locate elements in the recorded page by CSS selector, by visible text, by ARIA role, or any',
    'combination of the three, and get back a selector for each that stays valid as the page changes,',
    'plus the window of time the element existed. Call this before bisect or measure_layout: those tools',
    'take a selector and re-resolve it at other timestamps, so a selector from here is what keeps them',
    `pointing at the same element. At most ${MATCH_LIMIT} matches come back.`,
  ].join(' '),

  inputSchema: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description:
          'CSS selector to match, e.g. "select[name=province]" or "#checkout button". Combine with text or role to narrow it further.',
      },
      text: {
        type: 'string',
        description:
          'Case-insensitive text the element must contain, e.g. "Pay" or "is required". Only the innermost matching element is returned, not its wrappers.',
      },
      role: {
        type: 'string',
        description:
          'ARIA role, matched against both an explicit role attribute and the implicit role of the tag: "button" also finds <button>, "combobox" finds <select>, "link" finds <a href>. Example: "button".',
      },
      timestamp: {
        type: 'number',
        description:
          'The moment to look at, in ms from the start of the recording. Defaults to where the human\'s playhead currently is. Pass a value when the element only exists for part of the recording.',
      },
    },
    additionalProperties: false,
  },

  async execute(args) {
    // Arguments first, engine second: a malformed call must come back as "fix this", not as "retry",
    // which an agent would do with the same malformed call.
    const recording = currentRecording()
    if (!recording.ok) return recording.response

    const selectorArg = optionalString(args, 'selector')
    if (!selectorArg.ok) return selectorArg.response
    const textArg = optionalString(args, 'text', 100)
    if (!textArg.ok) return textArg.response
    const roleArg = optionalString(args, 'role', 30)
    if (!roleArg.ok) return roleArg.response

    if (selectorArg.value === undefined && textArg.value === undefined && roleArg.value === undefined) {
      return toolError(
        'find_element needs at least one of "selector", "text" or "role". Example: { "role": "combobox", "text": "province" }.',
      )
    }
    if (selectorArg.value !== undefined) {
      const validated = validateSelector(selectorArg.value)
      if (!validated.ok) return toolError(validated.error)
    }
    if (roleArg.value !== undefined && !ROLE_PATTERN.test(roleArg.value)) {
      return toolError(
        `'${roleArg.value}' is not an ARIA role name. Roles are letters and hyphens, up to 30 characters, e.g. "button" or "combobox".`,
      )
    }

    const timestampArg = optionalNumber(args, 'timestamp')
    if (!timestampArg.ok) return timestampArg.response
    const atMs = Math.min(Math.max(timestampArg.value ?? sessionState().currentTime, 0), recording.value.durationMs)

    const engine = currentEngine()
    if (!engine.ok) return engine.response

    const mirror = await documentAt(engine.value, atMs)
    if (!mirror.ok) return mirror.response

    const criteria: FindCriteria = {
      ...(selectorArg.value === undefined ? {} : { selector: selectorArg.value }),
      ...(roleArg.value === undefined ? {} : { role: roleArg.value }),
      ...(textArg.value === undefined ? {} : { text: textArg.value }),
    }

    const found = findCandidates(mirror.value, criteria)
    const truncated = found.length > MATCH_LIMIT
    const shortlist = truncated ? found.slice(0, MATCH_LIMIT) : found

    // Selectors are computed against the document as it stands at `atMs`, before any probing moves the
    // replay: `stableSelectorFor` reads the tree, and the tree changes under a seek.
    const described = shortlist.map((element) => ({
      element,
      stable: stableSelectorFor(element, mirror.value),
      tagName: element.tagName.toLowerCase(),
      textSnippet: oneLine(element.textContent ?? '', SNIPPET_CHARS),
    }))

    const matches: FoundMatch[] = []
    for (const entry of described) {
      // Each match costs two bisects, so a failure on one must not lose the other four. A lifetime we
      // could not measure comes back null rather than as a plausible number.
      let lifetime: { firstSeenMs: number | null; lastSeenMs: number | null } = {
        firstSeenMs: null,
        lastSeenMs: null,
      }
      try {
        lifetime = await lifetimeOf(engine.value, entry.stable.selector, recording.value.durationMs)
      } catch {
        lifetime = { firstSeenMs: null, lastSeenMs: null }
      }

      matches.push({
        selector: entry.stable.selector,
        tagName: entry.tagName,
        textSnippet: entry.textSnippet,
        firstSeenMs: lifetime.firstSeenMs,
        lastSeenMs: lifetime.lastSeenMs,
        ...(entry.stable.unique
          ? {}
          : {
              selectorMatchesMultiple: true,
              selectorNote:
                'No unique stable selector exists for this element, so this one matches several and bisect ' +
                'will use the first. Narrow it with a nearby id or data-testid before relying on it.',
            }),
      })
    }

    await restorePlayhead(engine.value)

    return json({
      atMs,
      criteria,
      matches,
      totalMatched: found.length,
      truncated,
      ...(truncated
        ? {
            note:
              `${found.length} elements matched and the first ${MATCH_LIMIT} are shown. Narrow it: add "text", ` +
              'add a container to the selector, or use a more specific role.',
          }
        : {}),
      ...(found.length === 0
        ? {
            note:
              `Nothing matched at ${atMs} ms. The element may not exist at this moment — call read_dom_at at ` +
              'the same timestamp to see what is actually on the page, or try a timestamp from list_events.',
          }
        : {}),
    })
  },
}
