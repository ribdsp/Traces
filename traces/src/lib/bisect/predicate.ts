import type { Predicate, PredicateKind } from '@/types/domain'

/**
 * The security boundary of Traces.
 *
 * Contract: docs/tools.md#predicates. Threats: docs/threat-model.md (T1, T2).
 *
 * A predicate arrives from a language model, so it is untrusted input in the strongest sense: it may
 * be malformed, it may be adversarial, and it may be a confident attempt to smuggle in an
 * expression. The defence is structural rather than defensive — there is no variant that carries
 * code, so there is nothing to sanitise. `eval`, `new Function`, dynamic `import()` of a
 * model-supplied string and `setTimeout("string")` appear nowhere in this codebase, and
 * `no-eval.test.ts` greps the source and fails the build if any of them ever does.
 *
 * The validator below is written out in full rather than left as a stub, deliberately: it is the one
 * piece of this project where a shortcut taken at 2am under deadline pressure would be genuinely
 * dangerous, and a validator that already exists is much harder to quietly loosen than one somebody
 * still has to write.
 */

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** The complete set. Anything else is rejected by name, with the supported list in the message. */
export const PREDICATE_KINDS: PredicateKind[] = [
  'propertyEquals',
  'attributeExists',
  'attributeEquals',
  'optionCount',
  'visible',
  'textContains',
  'exists',
]

const PROPERTIES = ['disabled', 'checked', 'readOnly', 'value'] as const

/** Attribute names only: letters and hyphens. Blocks quotes, brackets and whitespace outright. */
const ATTRIBUTE_PATTERN = /^[a-zA-Z-]{1,30}$/

const MAX_TEXT_LENGTH = 100
const MAX_SELECTOR_LENGTH = 200

function fail<T>(error: string): ValidationResult<T> {
  return { ok: false, error }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate a predicate coming from a model.
 *
 * Errors are phrased for a reader that will try again immediately: name what was wrong and list what
 * is accepted. An agent handed `Unsupported predicate kind 'jsExpression'. Supported: ...` corrects
 * itself on the next call; an agent handed `Invalid input` retries the same mistake.
 */
export function validatePredicate(input: unknown): ValidationResult<Predicate> {
  if (!isRecord(input)) {
    return fail('Predicate must be an object, e.g. { "kind": "propertyEquals", "property": "disabled", "equals": true }.')
  }

  const kind = input.kind
  if (typeof kind !== 'string') {
    return fail(`Predicate is missing "kind". Supported: ${PREDICATE_KINDS.join(', ')}.`)
  }
  if (!PREDICATE_KINDS.includes(kind as PredicateKind)) {
    return fail(`Unsupported predicate kind '${kind}'. Supported: ${PREDICATE_KINDS.join(', ')}.`)
  }

  switch (kind as PredicateKind) {
    case 'propertyEquals': {
      const { property, equals } = input
      if (typeof property !== 'string' || !PROPERTIES.includes(property as (typeof PROPERTIES)[number])) {
        return fail(`propertyEquals needs "property" to be one of: ${PROPERTIES.join(', ')}.`)
      }
      if (typeof equals !== 'string' && typeof equals !== 'boolean') {
        return fail('propertyEquals needs "equals" to be a string or a boolean.')
      }
      if (property === 'value' && typeof equals === 'string' && equals.length > MAX_TEXT_LENGTH) {
        return fail(`propertyEquals "equals" is limited to ${MAX_TEXT_LENGTH} characters.`)
      }
      return {
        ok: true,
        value: { kind: 'propertyEquals', property: property as (typeof PROPERTIES)[number], equals },
      }
    }

    case 'attributeExists': {
      const { attribute } = input
      if (typeof attribute !== 'string' || !ATTRIBUTE_PATTERN.test(attribute)) {
        return fail('attributeExists needs "attribute" to be an attribute name: letters and hyphens, up to 30 characters.')
      }
      return { ok: true, value: { kind: 'attributeExists', attribute } }
    }

    case 'attributeEquals': {
      const { attribute, equals } = input
      if (typeof attribute !== 'string' || !ATTRIBUTE_PATTERN.test(attribute)) {
        return fail('attributeEquals needs "attribute" to be an attribute name: letters and hyphens, up to 30 characters.')
      }
      if (typeof equals !== 'string') {
        return fail('attributeEquals needs "equals" to be a string — attribute values always are.')
      }
      if (equals.length > MAX_TEXT_LENGTH) {
        return fail(`attributeEquals "equals" is limited to ${MAX_TEXT_LENGTH} characters.`)
      }
      return { ok: true, value: { kind: 'attributeEquals', attribute, equals } }
    }

    case 'optionCount': {
      const { equals } = input
      if (typeof equals !== 'number' || !Number.isInteger(equals) || equals < 0) {
        return fail('optionCount needs "equals" to be a non-negative integer. Use 0 to find an empty dropdown.')
      }
      return { ok: true, value: { kind: 'optionCount', equals } }
    }

    case 'visible': {
      const { equals } = input
      if (typeof equals !== 'boolean') {
        return fail('visible needs "equals" to be true or false.')
      }
      return { ok: true, value: { kind: 'visible', equals } }
    }

    case 'textContains': {
      const { text } = input
      if (typeof text !== 'string' || text.length === 0) {
        return fail('textContains needs a non-empty "text".')
      }
      if (text.length > MAX_TEXT_LENGTH) {
        return fail(`textContains "text" is limited to ${MAX_TEXT_LENGTH} characters.`)
      }
      return { ok: true, value: { kind: 'textContains', text } }
    }

    case 'exists': {
      const { equals } = input
      if (typeof equals !== 'boolean') {
        return fail('exists needs "equals" to be true or false.')
      }
      return { ok: true, value: { kind: 'exists', equals } }
    }
  }
}

/**
 * Validate a CSS selector before any searching starts.
 *
 * Checked up front on purpose: a selector that turns out to be malformed on the fourth bisect probe
 * has already cost the agent four replays and produces an error that looks like our bug, not its own.
 */
export function validateSelector(input: unknown): ValidationResult<string> {
  if (typeof input !== 'string' || input.trim().length === 0) {
    return fail('Selector must be a non-empty CSS selector string, e.g. "#checkout button[type=submit]".')
  }
  if (input.length > MAX_SELECTOR_LENGTH) {
    return fail(`Selector is limited to ${MAX_SELECTOR_LENGTH} characters.`)
  }
  try {
    // Parses the selector without touching the page. Throws SyntaxError on anything malformed.
    document.createDocumentFragment().querySelector(input)
  } catch {
    return fail(`'${input}' is not a valid CSS selector.`)
  }
  return { ok: true, value: input }
}

/**
 * Narrows an unknown value to boolean | string. Used instead of `any` when reading a DOM property
 * whose static type isn't known at this layer — see `readElementProperty` below.
 */
function isBooleanOrString(value: unknown): value is boolean | string {
  return typeof value === 'boolean' || typeof value === 'string'
}

/**
 * Read a live DOM property (not the attribute — `input.value` and `getAttribute('value')` diverge
 * the instant a user types, and observing what the user saw is the entire point). `Element` doesn't
 * type `disabled`/`checked`/`readOnly`/`value` generically — they only exist on specific HTML
 * interfaces — so this goes through `unknown` and narrows, rather than reaching for `any`.
 */
function readElementProperty(element: Element, property: string): boolean | string | undefined {
  const value = (element as unknown as Record<string, unknown>)[property]
  return isBooleanOrString(value) ? value : undefined
}

/**
 * Tag-name check rather than `instanceof HTMLSelectElement`: recordings replay inside rrweb's
 * iframe (docs/threat-model.md), which has its own global `HTMLSelectElement` constructor, so an
 * `instanceof` check against this frame's constructor can silently return false for a real
 * `<select>` living in that other realm.
 */
function isSelectElement(element: Element): element is HTMLSelectElement {
  return element.tagName === 'SELECT'
}

/**
 * `optionCount` only means something on a `<select>`. Anything else is a readable error, not a
 * silent `false` — a caller asking `optionCount` of a `<div>` almost certainly pointed the selector
 * at the wrong element, and `false` would look like a legitimate (if surprising) answer instead of a
 * mistake to fix. This is why `evaluatePredicate`'s return type says `boolean` but this path throws;
 * see the final report for that tension spelled out.
 */
function countOptions(element: Element): number {
  if (!isSelectElement(element)) {
    throw new Error(
      `optionCount only applies to <select> elements, got <${element.tagName.toLowerCase()}>. ` +
        'Point the selector at the <select> itself, not a wrapping element.',
    )
  }
  return element.options.length
}

/**
 * `element.offsetParent === null` for `display: none` and for elements with no layout box (zero
 * height counts, however present the element is in the tree), plus computed `visibility` and
 * `opacity`. Note: jsdom does not implement layout, so `offsetParent` is always `null` there and
 * every element reads as not-visible under test — this is written for, and correct in, a real
 * browser, which is what actually replays a recording.
 */
function isElementVisible(element: Element): boolean {
  const htmlElement = element as HTMLElement
  if (htmlElement.offsetParent === null) return false
  const style = getComputedStyle(element)
  if (style.visibility === 'hidden' || style.visibility === 'collapse') return false
  return Number(style.opacity) !== 0
}

/** Case-insensitive, on textContent, trimmed. */
function containsText(element: Element, text: string): boolean {
  const content = (element.textContent ?? '').trim().toLowerCase()
  return content.includes(text.trim().toLowerCase())
}

/**
 * Evaluate a validated predicate against a live element.
 *
 * `element` is null when nothing matched at this point in time. That case returns false *for every
 * variant*, checked once up front before dispatching on `kind` — including `{ kind: 'exists', equals:
 * true }`, which might look like it should throw or need special handling, and doesn't. The caller
 * reports absence separately via `BisectStep.elementMissing`, so "false" here never has to also mean
 * "missing" — see the null-element test in predicate.test.ts.
 *
 * The switch is exhaustive over `Predicate['kind']`: the `default` branch assigns to a `never`, so
 * adding a variant to the union without a case here fails the build instead of silently falling
 * through to `false`.
 */
export function evaluatePredicate(predicate: Predicate, element: Element | null): boolean {
  if (element === null) return false

  switch (predicate.kind) {
    case 'propertyEquals':
      return readElementProperty(element, predicate.property) === predicate.equals

    case 'attributeExists':
      return element.hasAttribute(predicate.attribute)

    case 'attributeEquals':
      return element.getAttribute(predicate.attribute) === predicate.equals

    case 'optionCount':
      return countOptions(element) === predicate.equals

    case 'visible':
      return isElementVisible(element) === predicate.equals

    case 'textContains':
      return containsText(element, predicate.text)

    case 'exists':
      // `element` is non-null here, so existence is true; the predicate holds when the caller
      // wanted existence. `{ kind: 'exists', equals: false }` against a present element is false —
      // it does not mean "treat this like elementMissing", which is a distinct, separately-reported
      // signal (see BisectStep in types/domain.ts).
      return predicate.equals === true

    default: {
      const exhaustive: never = predicate
      throw new Error(`Unsupported predicate kind: ${JSON.stringify(exhaustive)}`)
    }
  }
}
