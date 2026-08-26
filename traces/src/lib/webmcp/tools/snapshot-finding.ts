import type { Hypothesis, Marker, Report } from '@/types/domain'
import { sessionState } from '@/lib/store/session'
import { type ToolDefinition, json, noRecording, toolError } from '../tool-types'
import { capList, capText, optionalString } from './tool-support'

/**
 * 'snapshot_finding' — see docs/tools.md for the full contract.
 *
 * Owner: Vicko.
 *
 * Implemented — vicko, Day 5:
 *   - markers, hypotheses and the report draft serialised to localStorage under one key, so a reload
 *     does not lose an investigation and the human can copy the JSON out
 *   - a real budget (below) with a readable error on every rejection path: no storage available, quota
 *     exceeded, nothing to save yet
 *
 * Small tool, deliberately not clever. It writes data, never markup — nothing here reaches
 * `innerHTML`, and the name is slugified before it becomes part of a storage key.
 */

/** Per-list caps. A snapshot is a record of an investigation, not an export of the whole session. */
export const SNAPSHOT_MARKER_MAX = 60
export const SNAPSHOT_HYPOTHESIS_MAX = 20
export const SNAPSHOT_STEP_MAX = 40
export const SNAPSHOT_NAME_MAX = 60

/**
 * The serialised payload's ceiling.
 *
 * localStorage is typically 5MB per origin and shared with everything else on it, so the failure this
 * guards against is not our own size but ours plus everyone else's. 200,000 characters is roughly two
 * orders of magnitude under the quota and far above anything the per-list caps can produce; if it is
 * ever hit, something upstream is wrong and a readable error beats a QuotaExceededError.
 */
export const SNAPSHOT_CHAR_BUDGET = 200_000

const KEY_PREFIX = 'traces.snapshot'

/** Untrusted input becoming part of a storage key: reduced to a closed character set first. */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SNAPSHOT_NAME_MAX)
  return slug.length > 0 ? slug : 'finding'
}

/**
 * localStorage, or null.
 *
 * Both the `typeof` check and the try/catch are needed: the property is absent during SSR, and reading
 * it *throws* rather than returning undefined when storage is blocked by a privacy setting.
 */
function storage(): Storage | null {
  try {
    if (typeof globalThis.localStorage === 'undefined') return null
    return globalThis.localStorage
  } catch {
    return null
  }
}

export const snapshotFindingTool: ToolDefinition = {
  name: 'snapshot_finding',
  description: "Save the current findings, meaning markers, hypotheses and the report draft, so they survive a reload and can be copied out.",

  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: `A short name for this snapshot, e.g. "empty province dropdown". Used to label it and to build its storage key; at most ${SNAPSHOT_NAME_MAX} characters. Omit it and the recording id plus the time is used.`,
      },
    },
    additionalProperties: false,
  },

  async execute(args) {
    const state = sessionState()
    if (state.recording === null) return noRecording()

    const name = optionalString(args, 'name')
    if (!name.ok) return toolError(name.error)

    const store = storage()
    if (store === null) {
      return toolError(
        'This browser is not allowing local storage, so findings cannot be saved here. Tell the human to ' +
          'copy the report out of the panel instead — everything you found is still on screen.',
      )
    }

    const markers = capList(state.markers, SNAPSHOT_MARKER_MAX)
    const hypotheses = capList(state.hypotheses, SNAPSHOT_HYPOTHESIS_MAX)
    const report = state.report

    if (markers.items.length === 0 && hypotheses.items.length === 0 && report === null) {
      return toolError(
        'There is nothing to save yet: no markers, no hypotheses and no report draft. Call annotate, ' +
          'propose_hypotheses or propose_report first, then snapshot.',
      )
    }

    const label = capText(name.value ?? `${state.recording.id} ${new Date().toISOString()}`, SNAPSHOT_NAME_MAX)
    const key = `${KEY_PREFIX}.${state.recording.id}.${slugify(label.text)}`
    const steps = report === null ? null : capList(report.steps, SNAPSHOT_STEP_MAX)

    const payload = {
      version: 1,
      name: label.text,
      savedAt: new Date().toISOString(),
      recordingId: state.recording.id,
      durationMs: state.recording.durationMs,
      markers: markers.items.map(
        (marker: Marker) => ({
          id: marker.id,
          timestamp: marker.timestamp,
          label: marker.label,
          severity: marker.severity,
          author: marker.author,
          rejected: marker.rejected === true,
        }),
      ),
      hypotheses: hypotheses.items.map((hypothesis: Hypothesis) => ({
        id: hypothesis.id,
        text: hypothesis.text,
        confidence: hypothesis.confidence,
        status: hypothesis.status,
        author: hypothesis.author,
        evidence: hypothesis.evidence,
      })),
      report:
        report === null || steps === null
          ? null
          : ({ ...report, steps: steps.items } satisfies Report),
      truncated: markers.truncated || hypotheses.truncated || (steps?.truncated ?? false),
    }

    let serialised: string
    try {
      serialised = JSON.stringify(payload)
    } catch {
      return toolError('The findings could not be serialised. Nothing was saved; the panel still has them.')
    }

    if (serialised.length > SNAPSHOT_CHAR_BUDGET) {
      return toolError(
        `The findings serialise to ${serialised.length} characters, over the ${SNAPSHOT_CHAR_BUDGET} limit. ` +
          'Ask the human to reject the markers that no longer matter, then snapshot again.',
      )
    }

    try {
      store.setItem(key, serialised)
    } catch {
      return toolError(
        `Local storage refused the write for "${key}" — it is most likely full. Ask the human to clear ` +
          'older snapshots, or copy the report out of the panel instead.',
      )
    }

    return json({
      ok: true,
      id: key,
      name: label.text,
      counts: {
        markers: payload.markers.length,
        hypotheses: payload.hypotheses.length,
        reportSteps: payload.report?.steps.length ?? 0,
      },
      charCount: serialised.length,
      truncated: payload.truncated,
      ...(payload.truncated
        ? {
            nextStep:
              'Some findings were left out of the snapshot because there were more than it holds. Snapshot ' +
              'the most important ones first, or narrow what you annotate.',
          }
        : {}),
    })
  },
}
