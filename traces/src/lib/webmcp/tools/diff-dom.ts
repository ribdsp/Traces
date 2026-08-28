import { MAX_CHANGES, diffDom } from '@/lib/dom/diff-dom'
import { type ToolDefinition, json, toolError } from '../tool-types'
import { currentEngine, currentRecording, documentAt, requireTimestamp, restorePlayhead } from './tool-context'

/**
 * 'diff_dom' — see docs/tools.md#6-diff_dom for the full contract.
 *
 * Wraps lib/dom/diff-dom.
 *
 * The whole difficulty of this wrapper is that a diff needs two documents
 * and there is exactly one Replayer, which mutates its single iframe document in place on every seek.
 * Hold a reference at 1,400 ms, seek to 2,600 ms, and both references show 2,600 ms — so the naive
 * implementation returns *zero changes*, confidently, for a window in which six options vanished. That
 * is why `diffDom` refuses two identical `Document` objects outright instead of returning an empty
 * diff.
 *
 * The route that works, and the one used below:
 *
 *   gotoTime(from) → mirrorDocument().cloneNode(true) → gotoTime(to) → diffDom(clone, live)
 *
 * Verified rather than assumed, under jsdom: the clone kept both `<option>` children after the live
 * document had them removed, and the diff came back with the right five changes (an added error `<div>`,
 * `aria-invalid` and `disabled` appearing, two removed options). The clone is safe on the axis that
 * looked risky — a detached document has no layout, but `diffDom`'s node selection reads `matches`,
 * `hasAttribute` and direct text only, never computed style; `compress-dom` reads computed style solely
 * when rendering a line, which this path does not do. `lib/dom/diff-dom.ts` reports the same route
 * verified in Chromium against a real recording.
 *
 * **`scope` is not accepted, though docs §6 lists it.** `diffDom` takes `{ document, atMs }` and roots
 * itself at `document.body`; there is no seam for a subtree, and faking one by building a throwaway
 * document around a cloned subtree would put DOM surgery in a tool wrapper. Declaring an argument that
 * is silently ignored is worse than not having it — an agent would believe it had narrowed the diff.
 */
export const diffDomToolDefinition: ToolDefinition = {
  name: 'diff_dom',
  description: [
    'Compare the recorded page at two moments and get back a short list of what was added, removed, and',
    'what attributes or text changed. Use it straight after bisect: bisect tells you when something',
    'changed, this tells you what else changed at the same time, which is usually where the cause is.',
    `Only elements read_dom_at would show are compared, and at most ${MAX_CHANGES} changes come back, so`,
    'keep the interval tight — a second either side of a transition beats the whole recording.',
  ].join(' '),

  // Reads two instants and restores the playhead. Every change it reports quotes the old and new text or
  // attribute value, so the payload is recorded content by construction.
  annotations: { readOnlyHint: true, untrustedContentHint: true },

  inputSchema: {
    type: 'object',
    properties: {
      from: {
        type: 'number',
        description:
          'The earlier moment, in ms from the start of the recording. Example: 27900, just before a transition bisect found at 28412.',
      },
      to: {
        type: 'number',
        description:
          'The later moment, in ms from the start of the recording. Example: 28900, just after that transition. Must be different from "from".',
      },
    },
    required: ['from', 'to'],
    additionalProperties: false,
  },

  async execute(args) {
    // Arguments first, engine second: "fix this argument" is actionable, "retry, the player is still
    // mounting" is not — and an agent given the second for a bad argument retries the bad argument.
    const recording = currentRecording()
    if (!recording.ok) return recording.response

    const from = requireTimestamp(args, 'from', recording.value)
    if (!from.ok) return from.response
    const to = requireTimestamp(args, 'to', recording.value)
    if (!to.ok) return to.response

    if (from.value === to.value) {
      return toolError(
        `'from' and 'to' are both ${from.value} ms, so there is nothing to compare. Pass two different moments — ` +
          'if bisect gave you a transition at T, try from: T - 1000 and to: T + 1000.',
      )
    }
    if (from.value > to.value) {
      return toolError(
        `'from' (${from.value} ms) is after 'to' (${to.value} ms). Pass the earlier moment as 'from' — the ` +
          'response describes what changed going forwards in time.',
      )
    }

    const engine = currentEngine()
    if (!engine.ok) return engine.response

    // Snapshot the earlier moment before seeking away from it. See the note at the top of this file.
    const before = await documentAt(engine.value, from.value)
    if (!before.ok) return before.response

    let beforeClone: Document
    try {
      beforeClone = before.value.cloneNode(true) as Document
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return toolError(
        `The page at ${from.value} ms could not be snapshotted for comparison: ${detail} Try read_dom_at at each ` +
          'of the two moments and compare them yourself.',
      )
    }

    const after = await documentAt(engine.value, to.value)
    if (!after.ok) return after.response

    let result
    try {
      result = diffDom({ document: beforeClone, atMs: from.value }, { document: after.value, atMs: to.value })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return toolError(`The two moments could not be compared: ${detail}`)
    }

    await restorePlayhead(engine.value)

    const counts = {
      added: result.changes.filter((change) => change.kind === 'added').length,
      removed: result.changes.filter((change) => change.kind === 'removed').length,
      attributeChanged: result.changes.filter((change) => change.kind === 'attributeChanged').length,
      textChanged: result.changes.filter((change) => change.kind === 'textChanged').length,
    }

    return json({
      ...result,
      counts,
      ...(result.truncated
        ? {
            note:
              `More than ${MAX_CHANGES} changes happened between these moments, so the least informative were ` +
              'dropped — interactive elements and structural changes are kept first. Narrow the interval around ' +
              'the transition you care about and call again.',
          }
        : {}),
      ...(result.changes.length === 0
        ? {
            note:
              'Nothing changed among the elements read_dom_at reports between these two moments. Widen the ' +
              'interval, or read_dom_at at each end to confirm you are looking at the part of the page you think ' +
              'you are.',
          }
        : {}),
    })
  },
}
