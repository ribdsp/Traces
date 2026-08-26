import type { Predicate, PredicateKind } from '@/types/domain'

/**
 * The security boundary of Traces.
 *
 * Owner: Riko. Contract: docs/tools.md#predicates. Threats: docs/threat-model.md (T1, T2).
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
 * Evaluate a validated predicate against a live element.
 *
 * `element` is null when nothing matched at this point in time. That case must return false *and*
 * be reported as `elementMissing` by the caller — see BisectStep. An agent that cannot tell "the
 * button was enabled" from "there was no button yet" reports the wrong moment with full confidence.
 *
 * TODO(riko), Day 2. The switch is exhaustive, so TypeScript will name any variant you forget.
 *   - propertyEquals: read the property off the element, not the attribute. `input.value` and
 *     `[value]` diverge the instant a user types, and the whole point is to observe what the user saw
 *   - visible: offsetParent plus computed visibility and opacity — an element with zero height is
 *     not visible however present it is in the tree
 *   - optionCount: only meaningful on a <select>; anything else is a readable error, not false
 *   - textContains: case-insensitive, on textContent, trimmed
 */
export function evaluatePredicate(_predicate: Predicate, _element: Element | null): boolean {
  throw new Error('evaluatePredicate: not implemented')
}
