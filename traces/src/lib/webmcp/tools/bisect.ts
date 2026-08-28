import { PREDICATE_KINDS, evaluatePredicate, validatePredicate, validateSelector } from '@/lib/bisect/predicate'
import { DEFAULT_PRECISION_MS, type BisectProbe, bisect } from '@/lib/bisect/bisect'
import { sessionActions } from '@/lib/store/session'
import { type ToolDefinition, json, requireNumber, toolError } from '../tool-types'
import { currentEngine, currentRecording, restorePlayhead } from './tool-context'

/**
 * `bisect` — binary-search the replay timeline for the first moment a predicate holds.
 *
 * Wraps lib/bisect. Contract: docs/tools.md#4-bisect.
 *
 * This is the tool the project exists for, and the reason it cannot be an API endpoint: the agent
 * sends a *predicate*, and the page runs a search — replaying to a different point in time on each
 * iteration and evaluating that predicate against the live DOM at each one. The agent is programming
 * the page, not querying it. There is no REST shape for "replay this recording to ten different
 * moments and tell me where this became true", and no amount of clicking or DOM-scraping produces it
 * either.
 *
 * The schema is written out in full here because this is the tool a model is most likely to get
 * wrong, and every field description below is a sentence that prevents one specific wrong call.
 */
export const bisectTool: ToolDefinition = {
  name: 'bisect',
  description: [
    'Find the first moment in the recording when a condition became true about an element, using a',
    'binary search over the replay timeline. Use this instead of reading the DOM at many timestamps:',
    'it takes about ten replays instead of dozens, and it returns a millisecond, not a guess.',
    'Typical use: locating exactly when a button became disabled, when a dropdown lost its options,',
    'or when an error message first appeared. The condition is assumed to change once and stay',
    'changed. Call read_session_meta first to learn the recording duration.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description:
          'CSS selector for the element to watch, e.g. "#checkout button[type=submit]". Use find_element first if you are not sure it exists.',
      },
      predicate: {
        type: 'object',
        description:
          'The condition to search for. A structured object from a fixed set — expressions and code are not accepted.',
        properties: {
          kind: {
            type: 'string',
            enum: PREDICATE_KINDS,
            description:
              'propertyEquals: a live DOM property. attributeExists / attributeEquals: an attribute. optionCount: number of <option> children, use 0 to find an empty dropdown. visible: rendered and non-zero-sized. textContains: substring of the text content. exists: the element is in the document.',
          },
          property: {
            type: 'string',
            enum: ['disabled', 'checked', 'readOnly', 'value'],
            description: 'For propertyEquals only.',
          },
          attribute: {
            type: 'string',
            description: 'For attributeExists and attributeEquals. Letters and hyphens, up to 30 characters.',
          },
          text: { type: 'string', description: 'For textContains. Up to 100 characters, matched case-insensitively.' },
          equals: {
            description:
              'The value to compare against: boolean for visible and exists, integer for optionCount, string or boolean for propertyEquals, string for attributeEquals.',
          },
        },
        required: ['kind'],
      },
      from: { type: 'number', description: 'Start of the search window, in ms from the beginning of the recording.' },
      to: { type: 'number', description: 'End of the search window, in ms. Usually durationMs from read_session_meta.' },
      precisionMs: {
        type: 'number',
        description: `How close the answer needs to be, in ms. Defaults to ${DEFAULT_PRECISION_MS}. Larger is faster.`,
      },
    },
    required: ['selector', 'predicate', 'from', 'to'],
    additionalProperties: false,
  },

  /**
   * What the wrapper is responsible for, in order:
   *
   *   - `validateSelector` and `validatePredicate` first, their messages returned verbatim: they are
   *     already written for a model to act on, and rephrasing them here would produce two vocabularies
   *     for one rejection.
   *   - `from`/`to` clamped into the recording, an inverted window rejected. Clamping rather than
   *     rejecting an over-long `to` is deliberate — "search to the end" is what `to: 999999` means, and
   *     the clamp is reported in the response so the agent sees the window that was actually searched.
   *   - the probe: seek, `querySelector` in the *mirror* document, `evaluatePredicate`. A selector that
   *     matches nothing at that instant reports `elementMissing`, which is a different finding from
   *     `false` (docs/tools.md#4).
   *   - the trace goes into the store, so `BisectTrace` animates the six jumps a human then watches.
   *   - `elapsedMs` comes back measured by `lib/bisect`, not described here. It is a claim in the
   *     submission, so it has to be a measurement.
   */
  async execute(args) {
    // The whole argument surface is validated before the engine is required. A predicate the validator
    // rejects is the agent's to fix; "the player has not mounted" tells it to retry, and answering a
    // malformed predicate with "retry" gets the same predicate back on the next call.
    const recording = currentRecording()
    if (!recording.ok) return recording.response

    const selector = validateSelector(args.selector)
    if (!selector.ok) return toolError(selector.error)

    const predicate = validatePredicate(args.predicate)
    if (!predicate.ok) return toolError(predicate.error)

    const fromArg = requireNumber(args, 'from')
    if (!fromArg.ok) return toolError(fromArg.error)
    const toArg = requireNumber(args, 'to')
    if (!toArg.ok) return toolError(toArg.error)

    const clamp = (value: number): number => Math.min(Math.max(value, 0), recording.value.durationMs)
    const from = clamp(fromArg.value)
    const to = clamp(toArg.value)

    if (from > to) {
      return toolError(
        `'from' (${fromArg.value} ms) is after 'to' (${toArg.value} ms), so there is no window to search. ` +
          `Pass from <= to; this recording runs from 0 to ${recording.value.durationMs} ms.`,
      )
    }

    const precisionArg = args.precisionMs
    if (precisionArg !== undefined && precisionArg !== null) {
      if (typeof precisionArg !== 'number' || !Number.isFinite(precisionArg) || precisionArg <= 0) {
        return toolError(
          `'precisionMs' must be a positive number of milliseconds, or omitted for the default of ${DEFAULT_PRECISION_MS}.`,
        )
      }
    }
    const precisionMs = typeof precisionArg === 'number' ? precisionArg : DEFAULT_PRECISION_MS

    const engine = currentEngine()
    if (!engine.ok) return engine.response

    /**
     * One probe. `elementMissing` is set separately from `result` on purpose: "the button is not
     * disabled" and "the button does not exist yet" are different findings, and an agent handed only
     * `false` for both reports a state change that was really an element appearing.
     */
    const probe: BisectProbe = async (atMs) => {
      await engine.value.gotoTime(atMs)
      const element = engine.value.mirrorDocument().querySelector(selector.value)
      if (element === null) return { result: false, elementMissing: true }
      return { result: evaluatePredicate(predicate.value, element), elementMissing: false }
    }

    let result
    try {
      result = await bisect({ from, to, precisionMs, probe })
    } catch (error) {
      // `evaluatePredicate` throws for a predicate that cannot apply to the element it found — asking
      // `optionCount` of a `<div>`, for instance — and the mirror document throws while the player is
      // still starting up. Both are the agent's next move, not a crash.
      const detail = error instanceof Error ? error.message : String(error)
      return toolError(`The search stopped at a probe: ${detail}`)
    }

    // The human watches the playhead jump through these; without this the search would be invisible.
    sessionActions().setBisectTrace(result.trace)
    await restorePlayhead(engine.value)

    const clamped = from !== fromArg.value || to !== toArg.value

    return json({
      ...result,
      searchedFromMs: from,
      searchedToMs: to,
      ...(clamped
        ? {
            note:
              `The window was clamped to the recording: searched ${from}–${to} ms of a ${recording.value.durationMs} ms ` +
              'recording. Call read_session_meta for the duration if that is not what you meant.',
          }
        : {}),
      ...(result.firstTrue === null
        ? {
            note:
              `The condition never held between ${from} and ${to} ms. That is an answer, not a failure: widen the ` +
              'window, or check with read_dom_at at one timestamp that you are describing the state you think you are.',
          }
        : {}),
      ...(result.alreadyTrueAtStart
        ? {
            note:
              `The condition already held at ${from} ms, so firstTrue is the floor of your window rather than the ` +
              'moment it changed. Search earlier — from: 0 — to find the actual transition.',
          }
        : {}),
    })
  },
}
