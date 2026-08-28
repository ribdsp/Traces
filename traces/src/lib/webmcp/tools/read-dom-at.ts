import { MAX_CHARS, MAX_LINES, compressDom } from '@/lib/dom/compress-dom'
import { validateSelector } from '@/lib/bisect/predicate'
import { type ToolDefinition, text, toolError } from '../tool-types'
import { currentEngine, currentRecording, documentAt, optionalString, requireTimestamp, restorePlayhead, rootOf } from './tool-context'

/**
 * 'read_dom_at' — see docs/tools.md#5-read_dom_at for the full contract.
 *
 * Wraps lib/dom/compress-dom.
 *
 * Returned as plain text rather than JSON, matching docs §5. The compressed DOM is already a
 * newline-indented format designed to be read by a model; wrapping it in JSON would escape every
 * newline in it, which costs tokens and makes the indentation — the part that carries the tree
 * structure — something the model has to decode rather than see.
 *
 * **`root` is passed explicitly, always.** `compressDom` defaults `root` to `document.body`, and in a
 * tool that runs on the Traces page that default is *the Traces UI itself*, not the replayed page. The
 * failure mode is not an error: it is a perfectly plausible compressed DOM of the wrong document,
 * which an agent has no way to detect. Hence `rootOf(mirror)`, never the default.
 */
export const readDomAtTool: ToolDefinition = {
  name: 'read_dom_at',
  description: [
    'Read the state of the recorded page at one moment as a compact, indented list of the interactive',
    'and state-bearing elements: form values, disabled and required flags, aria state, option counts,',
    'error text. This is not HTML — layout wrappers, classes and styling are dropped, and the output is',
    `capped at ${MAX_LINES} lines / ${MAX_CHARS} characters. Use it once you know which moment matters`,
    '(from list_events or bisect); pass "scope" to zoom into one container when the whole page is too',
    'broad. It cannot tell you where things are on screen or what covers what — that is measure_layout.',
  ].join(' '),

  // The single largest slab of recorded content any tool returns: form values, aria labels, error text.
  // If prompt injection reaches an agent through Traces, it arrives here.
  annotations: { readOnlyHint: true, untrustedContentHint: true },

  inputSchema: {
    type: 'object',
    properties: {
      timestamp: {
        type: 'number',
        description:
          'The moment to read, in ms from the start of the recording. Example: 28412 for 28.412 seconds in. Must be between 0 and durationMs from read_session_meta.',
      },
      scope: {
        type: 'string',
        description:
          'Optional CSS selector for a container to read instead of the whole page, e.g. "#checkout" or "form[name=payment]". Use this when the full-page read comes back truncated.',
      },
    },
    required: ['timestamp'],
    additionalProperties: false,
  },

  async execute(args) {
    // Arguments are validated before the engine is required, and the order is deliberate: a bad
    // argument is the agent's to fix, whereas "the player has not mounted" tells it to retry. Checking
    // readiness first would answer a malformed call with "try again", and the agent would — with the
    // same malformed call, forever.
    const recording = currentRecording()
    if (!recording.ok) return recording.response

    const timestamp = requireTimestamp(args, 'timestamp', recording.value)
    if (!timestamp.ok) return timestamp.response

    const scopeArg = optionalString(args, 'scope')
    if (!scopeArg.ok) return scopeArg.response

    // Validated before the seek: a malformed selector should cost nothing and say so up front.
    if (scopeArg.value !== undefined) {
      const selector = validateSelector(scopeArg.value)
      if (!selector.ok) return toolError(selector.error)
    }

    const engine = currentEngine()
    if (!engine.ok) return engine.response

    const mirror = await documentAt(engine.value, timestamp.value)
    if (!mirror.ok) return mirror.response

    let root = rootOf(mirror.value)
    if (scopeArg.value !== undefined) {
      // Belt and braces around the query itself: the selector was parsed against this frame's document,
      // and the replay lives in another realm. Nothing may throw out of `execute`.
      let scoped: Element | null
      try {
        scoped = mirror.value.querySelector(scopeArg.value)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        return toolError(`'${scopeArg.value}' could not be resolved against the recorded page: ${detail}`)
      }
      if (scoped === null) {
        return toolError(
          `No element matches '${scopeArg.value}' at ${timestamp.value} ms. The element may not exist yet at ` +
            'that moment: call find_element to get a selector that does, or omit "scope" to read the whole page.',
        )
      }
      root = scoped
    }

    const result = compressDom({ root, atMs: timestamp.value })

    // The replay goes back to where the human left it. docs/tools.md#10 makes `seek` the *only* tool
    // whose effect is on human attention, so a read must not quietly move what is on screen.
    await restorePlayhead(engine.value)

    const scopeLabel = scopeArg.value === undefined ? 'whole page' : `scope ${scopeArg.value}`
    const footer = `${result.lineCount} lines, ${result.charCount} chars (from ${result.sourceCharCount} chars of HTML).`
    const advice = result.truncated
      ? scopeArg.value === undefined
        ? 'Output hit the budget, so the least informative elements were dropped. Call again with "scope" set to a container selector — "#checkout", the form, the dialog — to see that part in full.'
        : `Output hit the budget even inside ${scopeArg.value}. Call again with a narrower "scope", or use find_element and measure_layout on the specific element you care about.`
      : null

    return text(
      [`DOM at ${timestamp.value} ms (${scopeLabel}):`, '', result.dom, '', footer, ...(advice ? [advice] : [])].join(
        '\n',
      ),
    )
  },
}
