import { PREDICATE_KINDS } from '@/lib/bisect/predicate'
import { DEFAULT_PRECISION_MS } from '@/lib/bisect/bisect'
import { type ToolDefinition, notImplemented } from '../tool-types'

/**
 * `bisect` — binary-search the replay timeline for the first moment a predicate holds.
 *
 * Owner: Vicko (wrapper) over Riko's lib/bisect. Contract: docs/tools.md#4-bisect.
 *
 * This is the tool the project exists for, and the reason it cannot be an API endpoint: the agent
 * sends a *predicate*, and the page runs a search — replaying to a different point in time on each
 * iteration and evaluating that predicate against the live DOM at each one. The agent is programming
 * the page, not querying it. There is no REST shape for "replay this recording to six different
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
    'it takes about six replays instead of dozens, and it returns a millisecond, not a guess.',
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
   * TODO(vicko), Day 3:
   *   - validateSelector and validatePredicate first, returning their messages verbatim as tool
   *     errors — they are written for a model to act on
   *   - clamp `from`/`to` to the recording, rejecting an inverted window with a readable error
   *   - build the probe: gotoTime via the replay engine, querySelector in the mirror document,
   *     evaluatePredicate; report `elementMissing` when nothing matched
   *   - push the trace into the store so BisectTrace animates it
   *   - return the whole BisectResult, including `alreadyTrueAtStart` and `elapsedMs`. The elapsed
   *     time is a claim in the submission, so it has to be measured rather than described
   */
  async execute() {
    return notImplemented('bisect')
  },
}
