import { validateSelector } from '@/lib/bisect/predicate'
import { measureLayout } from '@/lib/dom/measure-layout'
import { type ToolDefinition, json, toolError } from '../tool-types'
import { currentEngine, currentRecording, documentAt, requireTimestamp, restorePlayhead } from './tool-context'

/**
 * 'measure_layout' — see docs/tools.md#9-measure_layout for the full contract.
 *
 * Wraps lib/dom/measure-layout.
 *
 * This is the one visual bug class an agent can settle without eyes: a
 * button that is present, enabled, and simply covered. That answer only exists when the covering
 * element is measured in the *same call* as the covered one, because `overlaps` is computed pairwise
 * over the boxes in one result — hence a `selectors` array rather than the single `selector` docs §9
 * sketches, and hence the emphasis on that in the description.
 *
 * Numbers arrive already rounded from `lib/dom`, once, at construction, so the overlap arithmetic and
 * the numbers the agent reads are the same numbers.
 */

/**
 * Response budget. Ten selectors, and at most twenty boxes once each selector's matches are counted:
 * `measureLayout` emits a box per match, so `selectors: ["div"]` would otherwise return the geometry of
 * an entire page. Overlaps are bounded by the boxes — at most 190 pairs at the cap, and in practice a
 * handful, since a pair is only reported when the two z-indices differ.
 */
const SELECTOR_LIMIT = 10
const BOX_LIMIT = 20

export const measureLayoutToolDefinition: ToolDefinition = {
  name: 'measure_layout',
  description: [
    'Measure where elements were on screen at one moment — position, size, computed visibility, display,',
    'z-index — and which of them overlapped each other. This is how you diagnose a click that never',
    'landed: pass the element the user aimed at *and* the elements you suspect were on top of it in the',
    'same call, because overlap is only reported between elements measured together. Everything else',
    'about an element (its value, whether it is disabled, its text) comes from read_dom_at instead.',
  ].join(' '),

  /*
   * Read-only: it seeks the shared Replayer to measure, then puts the playhead back where the human left
   * it. No `untrustedContentHint` — the payload is geometry and the agent's own selectors, and this is
   * deliberately the one element tool that returns no text from the page (docs §9 sends you to
   * read_dom_at for that, which is annotated accordingly).
   */
  annotations: { readOnlyHint: true },

  inputSchema: {
    type: 'object',
    properties: {
      selectors: {
        type: 'array',
        description:
          'The elements to measure, as CSS selectors, e.g. ["#checkout button[type=submit]", ".modal-overlay"]. Pass every element you want compared in one call: overlaps are only computed between elements in the same array.',
        items: {
          type: 'string',
          description: 'One CSS selector. Use find_element first to get selectors that stay valid across the recording.',
        },
      },
      timestamp: {
        type: 'number',
        description:
          'The moment to measure, in ms from the start of the recording. Example: 28412. Geometry changes as the page reflows, so this is not optional.',
      },
    },
    required: ['selectors', 'timestamp'],
    additionalProperties: false,
  },

  async execute(args) {
    // Arguments first, engine second. A selector list the tool cannot accept is the agent's to fix; a
    // player that has not mounted is something to retry, and the two must not be confused.
    const recording = currentRecording()
    if (!recording.ok) return recording.response

    const raw = args.selectors
    if (!Array.isArray(raw) || raw.length === 0) {
      return toolError(
        "'selectors' must be a non-empty array of CSS selectors, e.g. [\"#pay\", \".overlay\"]. Pass the covered and covering elements together to get an overlap.",
      )
    }
    if (raw.length > SELECTOR_LIMIT) {
      return toolError(
        `'selectors' has ${raw.length} entries; measure_layout takes at most ${SELECTOR_LIMIT} per call. Split the list, keeping the elements you want compared for overlap in the same call.`,
      )
    }

    const selectors: string[] = []
    for (const candidate of raw) {
      const validated = validateSelector(candidate)
      if (!validated.ok) return toolError(validated.error)
      selectors.push(validated.value)
    }

    const timestamp = requireTimestamp(args, 'timestamp', recording.value)
    if (!timestamp.ok) return timestamp.response

    const engine = currentEngine()
    if (!engine.ok) return engine.response

    const mirror = await documentAt(engine.value, timestamp.value)
    if (!mirror.ok) return mirror.response

    // Counted before measuring, not truncated after: a box dropped from the response would silently
    // drop the overlap pairs it was part of, which is the one answer this tool exists to give.
    let matchCounts: { selector: string; count: number }[]
    try {
      matchCounts = selectors.map((selector) => ({
        selector,
        count: mirror.value.querySelectorAll(selector).length,
      }))
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return toolError(`One of the selectors could not be resolved against the recorded page: ${detail}`)
    }
    const total = matchCounts.reduce((sum, entry) => sum + entry.count, 0)
    if (total > BOX_LIMIT) {
      const worst = [...matchCounts].sort((left, right) => right.count - left.count)[0]
      return toolError(
        `These selectors match ${total} elements at ${timestamp.value} ms, and measure_layout reports at most ` +
          `${BOX_LIMIT} boxes${worst ? ` ('${worst.selector}' alone matches ${worst.count})` : ''}. Use find_element ` +
          'to pick the specific elements you mean, then measure those.',
      )
    }

    let result
    try {
      result = measureLayout(mirror.value, selectors, timestamp.value)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return toolError(`The elements could not be measured at ${timestamp.value} ms: ${detail}`)
    }

    // Back to where the human left it: docs/tools.md#10 makes `seek` the only tool that moves what a
    // person is looking at, and geometry has to be measured at the requested moment regardless.
    await restorePlayhead(engine.value)

    // `LayoutResult` has nowhere to say "this selector matched nothing" (types/domain.ts is frozen), and
    // an agent that asked about three elements and got two boxes should not have to work out which.
    const notMatched = selectors.filter(
      (selector) => !result.boxes.some((box) => box.selector === selector || box.selector.startsWith(`${selector} [match `)),
    )
    const zeroSized = result.boxes.filter((box) => box.width === 0 || box.height === 0).map((box) => box.selector)

    return json({
      ...result,
      ...(notMatched.length > 0
        ? {
            notMatched,
            notMatchedNote:
              `No element matched ${notMatched.map((selector) => `'${selector}'`).join(', ')} at ${timestamp.value} ms. ` +
              'Call find_element at the same timestamp to get a selector that resolves there.',
          }
        : {}),
      ...(zeroSized.length > 0
        ? {
            zeroSizedNote:
              `${zeroSized.join(', ')} measured 0 wide or 0 tall, meaning the element was in the document but had no ` +
              'layout box — collapsed, or display:none. Such elements cannot overlap anything, so they are left out ' +
              'of the overlap list.',
          }
        : {}),
      ...(result.overlaps.length === 0 && result.boxes.length > 1
        ? {
            overlapNote:
              'No overlaps to report. Either the boxes do not intersect, or they intersect at the same z-index, ' +
              'which carries no information about which one is on top. If you suspect an overlay, add its selector ' +
              'to this call rather than measuring it separately.',
          }
        : {}),
    })
  },
}
