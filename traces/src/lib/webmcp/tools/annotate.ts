import type { Severity } from '@/types/domain'
import { sessionActions, sessionState } from '@/lib/store/session'
import { type ToolDefinition, json, noRecording, requireNumber, requireString, toolError } from '../tool-types'
import { MARKER_LABEL_MAX, capText, clampToRecording } from './tool-support'

/**
 * 'annotate' — see docs/tools.md for the full contract.
 *
 * What shipped, and why:
 *   - `addMarker` with `author: 'agent'`, so the marker renders in the agent's colour and the human can
 *     reject or undo exactly this one thing (types/domain.ts § Author)
 *   - labels longer than MARKER_LABEL_MAX are rejected rather than trimmed: the label *is* the marker
 *     on screen, and a silently clipped one reads as a marker about something else
 *   - a repeat of the same label at the same moment returns the existing id instead of stacking a
 *     second pin. A host that reissues a tool call is not a human marking twice.
 *
 * **Doc drift, not a decision made here:** docs/tools.md §11 still documents
 * `severity: "low"|"medium"|"high"`. The frozen contract in types/domain.ts is
 * `Severity = 'info' | 'warn' | 'error'`, and `severityOf` in lib/store/session.ts maps digest kinds
 * onto those three, so the timeline's colours are keyed to them. The schema below follows the frozen
 * type; §11 is the side that needs correcting, by whoever owns the doc.
 */

/**
 * How many markers the agent may leave on one timeline.
 *
 * This tool's budget is on the *human's* screen rather than on the response: forty pins is already more
 * than anyone scans, and an agent that annotates every console error in a noisy recording produces a
 * timeline that is uniformly marked and therefore says nothing.
 */
export const AGENT_MARKER_BUDGET = 40

const SEVERITIES: readonly Severity[] = ['info', 'warn', 'error']

function asSeverity(value: unknown): Severity | null {
  return typeof value === 'string' && (SEVERITIES as readonly string[]).includes(value)
    ? (value as Severity)
    : null
}

export const annotateTool: ToolDefinition = {
  name: 'annotate',
  description: "Put a labelled marker on the human's timeline at a given moment. Markers you create are shown as yours, and the human can accept, reject or undo each one individually.",

  inputSchema: {
    type: 'object',
    properties: {
      timestamp: {
        type: 'number',
        description:
          'The moment to mark, in milliseconds from the start of the recording, e.g. 28412 for 28.412s.',
      },
      label: {
        type: 'string',
        description: `What is true at that moment, in a few words — this is the text shown under the pin, e.g. "province dropdown has 0 options". At most ${MARKER_LABEL_MAX} characters; put the reasoning in propose_hypotheses instead.`,
      },
      severity: {
        type: 'string',
        enum: SEVERITIES,
        description:
          'How the marker is coloured: "error" for something broken, "warn" for something suspicious, "info" for a moment worth finding again.',
      },
    },
    required: ['timestamp', 'label', 'severity'],
    additionalProperties: false,
  },

  async execute(args) {
    const state = sessionState()
    if (state.recording === null) return noRecording()

    const timestamp = requireNumber(args, 'timestamp')
    if (!timestamp.ok) return toolError(timestamp.error)

    const label = requireString(args, 'label')
    if (!label.ok) return toolError(label.error)

    const severity = asSeverity(args['severity'])
    if (severity === null) {
      return toolError(
        `'severity' is required and must be one of ${SEVERITIES.join(', ')}. Use "error" for something ` +
          'broken, "warn" for something suspicious, "info" for a moment worth finding again.',
      )
    }

    const capped = capText(label.value, MARKER_LABEL_MAX)
    if (capped.truncated) {
      return toolError(
        `'label' is ${label.value.trim().length} characters; keep it under ${MARKER_LABEL_MAX}. It is rendered ` +
          'under a pin on the timeline, so name the state in a few words and put the explanation in ' +
          'propose_hypotheses.',
      )
    }

    const agentMarkers = state.markers.filter((marker) => marker.author === 'agent')
    if (agentMarkers.length >= AGENT_MARKER_BUDGET) {
      return toolError(
        `You already have ${agentMarkers.length} markers on this timeline, which is the limit — a uniformly ` +
          'marked timeline points at nothing. Stop annotating and move on to propose_hypotheses or ' +
          'propose_report with the moments you already marked.',
      )
    }

    const at = clampToRecording(timestamp.value, state.recording.durationMs)

    // Idempotent on (timestamp, label): a reissued call must not leave two pins on one moment.
    const existing = agentMarkers.find(
      (marker) => marker.timestamp === at.atMs && marker.label === capped.text,
    )
    if (existing !== undefined) {
      return json({
        ok: true,
        id: existing.id,
        at: at.atMs,
        severity: existing.severity,
        nextStep: 'This moment already carried that exact marker, so nothing was added. Move on.',
      })
    }

    const id = sessionActions().addMarker({
      timestamp: at.atMs,
      label: capped.text,
      severity,
      author: 'agent',
    })

    return json({
      ok: true,
      id,
      at: at.atMs,
      severity,
      remaining: AGENT_MARKER_BUDGET - agentMarkers.length - 1,
      ...(at.clamped
        ? {
            nextStep:
              `${Math.round(timestamp.value)}ms is outside the recording, so the marker landed at ${at.atMs}ms. ` +
              `Use a timestamp between 0 and ${state.recording.durationMs} next time.`,
          }
        : {}),
    })
  },
}
