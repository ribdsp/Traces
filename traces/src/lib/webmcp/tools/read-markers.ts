import { sessionState } from '@/lib/store/session'
import type { Marker } from '@/types/domain'
import { type ToolDefinition, json } from '../tool-types'
import { currentRecording, optionalWindow, truncate } from './tool-context'
import { MARKER_LABEL_MAX } from './tool-support'

/**
 * 'read_markers' — see docs/tools.md#17-read_markers for the full contract.
 *
 * The read half of `annotate`. Every other read tool answers a question about the recording; this one
 * answers a question about the *investigation*, which until now the agent could only write to. It could
 * pin a marker and never see it again, and it could not see the human's markers at all — so a session
 * resumed after a reload, or picked up by a second agent, started blind to the moments a person had
 * already pointed at. `ask_human_visual` lands the human's answer on the timeline as a marker
 * (ask-human-visual.ts:284) precisely so it is evidence anyone can click; this is what makes "anyone"
 * include the agent.
 *
 * Read straight off the store rather than out of `lib/`, because markers are session state and not
 * something derivable from the events — there is no pure function to wrap. It still requires a loaded
 * recording: a marker is a timestamp into a recording, and answering "no markers" when nothing is
 * loaded would be read as "the human marked nothing", which is a different and much more misleading
 * fact.
 *
 * Rejected markers are returned, flagged, not filtered. `rejectMarker` keeps them so undo works, and an
 * agent that cannot see the rejection re-proposes the thing a human has already dismissed.
 */

/** Response budget, matching list_events, read_console and read_network. */
const MARKER_LIMIT = 40

type MarkerEntry = {
  id: string
  atMs: number
  label: string
  severity: Marker['severity']
  author: Marker['author']
  /** Present only when true — see the note on rejected markers above. */
  rejected?: boolean
}

/**
 * Both writers already cap a label at MARKER_LABEL_MAX, so this truncation never fires today. It is
 * here because the response budget is this tool's own responsibility: a future marker path that forgets
 * the cap should not be able to widen a tool response from somewhere else in the codebase.
 */
function toEntry(marker: Marker): MarkerEntry {
  return {
    id: marker.id,
    atMs: marker.timestamp,
    label: truncate(marker.label, MARKER_LABEL_MAX),
    severity: marker.severity,
    author: marker.author,
    ...(marker.rejected === true ? { rejected: true } : {}),
  }
}

export const readMarkersTool: ToolDefinition = {
  name: 'read_markers',
  description: [
    'List the markers pinned on the timeline inside a time window — what each one says, when it is, who',
    'made it, and whether a human rejected it. Use it to see what the person watching has already',
    'pointed at before you start looking, and to check what you pinned earlier survived: markers are the',
    'shared notes on this recording, and yours are only half of them. Pass a marker\'s atMs to seek to',
    'watch that moment.',
  ].join(' '),

  // No `untrustedContentHint`: a marker label is written by the human or by this agent, never lifted out
  // of the recorded page. Same reasoning as measure_layout, and the same as claim_next_task, which
  // returns human-typed task text and sets no flag either.
  annotations: { readOnlyHint: true },

  inputSchema: {
    type: 'object',
    properties: {
      from: {
        type: 'number',
        description:
          'Start of the window, in ms from the start of the recording. Defaults to 0, which is usually what you want here — there are rarely many markers.',
      },
      to: {
        type: 'number',
        description:
          'End of the window, in ms from the start of the recording. Defaults to the end of the recording (durationMs from read_session_meta).',
      },
    },
    additionalProperties: false,
  },

  async execute(args) {
    const recording = currentRecording()
    if (!recording.ok) return recording.response

    const window = optionalWindow(args, recording.value)
    if (!window.ok) return window.response

    const matched = sessionState()
      .markers.filter(
        (marker) => marker.timestamp >= window.value.fromMs && marker.timestamp <= window.value.toMs,
      )
      .map(toEntry)
      // Store order is insertion order, and a marker can be added at any timestamp at any time. A
      // timeline is read as a sequence, so it is sorted here rather than left in the order it was typed.
      .sort((left, right) => left.atMs - right.atMs)

    const humanCount = matched.filter((marker) => marker.author === 'human').length

    const truncated = matched.length > MARKER_LIMIT
    const kept = truncated
      ? // The human's markers survive the cap first: the agent already holds the ids of everything it
        // pinned itself, from annotate's own replies, so its own are the ones it can most afford to lose.
        // Chronological order is then restored. Array#sort is stable, so equal ranks keep their positions.
        [...matched]
          .sort((left, right) => Number(right.author === 'human') - Number(left.author === 'human'))
          .slice(0, MARKER_LIMIT)
          .sort((left, right) => left.atMs - right.atMs)
      : matched

    return json({
      fromMs: window.value.fromMs,
      toMs: window.value.toMs,
      markers: kept,
      totalMatched: matched.length,
      humanCount,
      agentCount: matched.length - humanCount,
      truncated,
      ...(truncated
        ? {
            note:
              `${matched.length} markers are in this window and ${MARKER_LIMIT} are shown, the human's kept first. ` +
              'Narrow the window around the moment you are working on.',
          }
        : {}),
      ...(matched.length === 0
        ? {
            note:
              'No markers in this window. Nothing has been pinned here yet — by you or by the human — so ' +
              'there is no earlier finding to build on. Call annotate once you can name what is wrong at a ' +
              'specific moment.',
          }
        : {}),
    })
  },
}
