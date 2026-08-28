import { type ToolDefinition, json } from '../tool-types'
import { currentRecording } from './tool-context'

/**
 * 'read_session_meta' — see docs/tools.md#1-read_session_meta for the full contract.
 *
 * The shape returned is `RecordingMeta` from types/domain.ts, unchanged: it was designed to be an
 * agent's first call and is already small. `load-recording.ts` derives every field of it once, at load
 * time, so this tool does no counting of its own — a second count here could disagree with the timeline
 * the human is looking at, and two different answers to "how many console errors" is worse than either.
 *
 * The one thing this tool has to police is `navigations`, which is the only unbounded field in that
 * shape: a recording of a wizard flow can hold a lot of URLs, and a URL is long.
 */

/**
 * Response budget. Twenty routes is more than enough to recognise a flow; past that the list stops
 * being orientation and starts being data, which is `list_events`' job.
 */
const NAVIGATION_BUDGET = 20

export const readSessionMetaTool: ToolDefinition = {
  name: 'read_session_meta',
  description:
    'Get the shape of the recording before anything else: duration, viewport, browser, pages visited, and counts of clicks, inputs, console errors and failed requests. Call this first, because every other tool takes times in ms relative to the start of the recording.',

  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },

  async execute() {
    const recording = currentRecording()
    if (!recording.ok) return recording.response

    const { meta } = recording.value
    const truncated = meta.navigations.length > NAVIGATION_BUDGET

    return json({
      recordingId: meta.recordingId,
      durationMs: meta.durationMs,
      eventCount: meta.eventCount,
      viewport: meta.viewport,
      userAgent: meta.userAgent,
      navigations: truncated ? meta.navigations.slice(0, NAVIGATION_BUDGET) : meta.navigations,
      counts: meta.counts,
      ...(truncated
        ? {
            navigationsTruncated: true,
            note:
              `Only the first ${NAVIGATION_BUDGET} of ${meta.navigations.length} navigations are listed. ` +
              'Call list_events with kinds ["navigation"] and a from/to window to page through the rest.',
          }
        : {}),
    })
  },
}
