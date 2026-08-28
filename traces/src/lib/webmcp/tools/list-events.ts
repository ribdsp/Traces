import { DIGEST_LIMIT, buildEventDigest } from '@/lib/replay/event-digest'
import type { DigestEventKind } from '@/types/domain'
import { type ToolDefinition, json, toolError } from '../tool-types'
import { currentRecording, optionalWindow } from './tool-context'

/**
 * 'list_events' — see docs/tools.md#2-list_events for the full contract.
 *
 * Wraps lib/replay/event-digest.
 *
 * Two things this wrapper is responsible for beyond calling the digest:
 *
 * 1. **`totalMatched` is counted, not inferred.** `buildEventDigest` returns `{ events, truncated }`
 *    and nothing else, so reporting `events.length` as the total would report the cap — 40 — as the
 *    answer to "how many console errors are in this window", every time there were more than 40. The
 *    digest is therefore asked for an unbounded list and capped here, where the pre-cap length is
 *    still in hand. One pass, because the digest keeps the *earliest* events on truncation, so the
 *    first 40 of the unbounded list are exactly the 40 it would have returned itself.
 * 2. **The truncation note names the two ways out** — a narrower window, or fewer kinds — because an
 *    agent told only that something was cut re-issues the same call.
 */

/**
 * The filter vocabulary, which is `DigestEventKind` verbatim: the same strings that come back in each
 * event's `kind` field. A separate, prettier vocabulary for the filter would mean an agent could not
 * take a `kind` out of a response and filter on it, which is the first thing an agent tries.
 */
const DIGEST_KINDS = [
  'click',
  'input',
  'navigation',
  'consoleError',
  'consoleWarn',
  'failedRequest',
  'rageClick',
] as const satisfies readonly DigestEventKind[]

/** Fails the build if a kind is ever added to `DigestEventKind` without appearing in the enum above. */
type MissingKind = Exclude<DigestEventKind, (typeof DIGEST_KINDS)[number]>
const _exhaustive: MissingKind extends never ? true : never = true
void _exhaustive

function isDigestKind(value: unknown): value is DigestEventKind {
  return typeof value === 'string' && (DIGEST_KINDS as readonly string[]).includes(value)
}

/**
 * `kinds` is optional; present-but-malformed is an error naming the accepted set, since an agent that
 * asked for `"error"` and got everything back would conclude the filter works and the recording is
 * noisy.
 */
function readKinds(value: unknown): { ok: true; value: DigestEventKind[] | undefined } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: undefined }
  if (!Array.isArray(value) || value.length === 0) {
    return {
      ok: false,
      error: `'kinds' must be a non-empty array of event kinds, or omitted to get all of them. Accepted: ${DIGEST_KINDS.join(', ')}.`,
    }
  }
  const unknownKinds = value.filter((entry) => !isDigestKind(entry))
  if (unknownKinds.length > 0) {
    return {
      ok: false,
      error: `Unsupported event kind(s) ${unknownKinds.map((entry) => JSON.stringify(entry)).join(', ')}. Accepted: ${DIGEST_KINDS.join(', ')}.`,
    }
  }
  return { ok: true, value: value.filter(isDigestKind) }
}

export const listEventsTool: ToolDefinition = {
  name: 'list_events',
  description: [
    'List the interesting things that happened in the recording, in time order: clicks, typing,',
    'navigations, console errors and warnings, failed network requests, and runs of repeated clicking',
    'on one element (rageClick). Mouse movement, scrolling and plain DOM mutations are deliberately',
    'left out — this is the orienting call you make after read_session_meta to decide where to look.',
    `At most ${DIGEST_LIMIT} entries come back, earliest first; narrow the window or the kinds rather`,
    'than asking for more.',
  ].join(' '),

  inputSchema: {
    type: 'object',
    properties: {
      kinds: {
        type: 'array',
        description:
          'Only return these kinds of event. Omit for all of them. Example: ["consoleError", "failedRequest"] to look for things that went wrong.',
        items: {
          type: 'string',
          enum: DIGEST_KINDS,
          description:
            'One event kind. rageClick is three or more clicks on the same element within a second, which usually marks the moment a user realised something was broken.',
        },
      },
      from: {
        type: 'number',
        description:
          'Start of the window, in ms from the start of the recording. Defaults to 0. Example: 20000 to look at everything after the 20-second mark.',
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

    const kinds = readKinds(args.kinds)
    if (!kinds.ok) return toolError(kinds.error)

    // Unbounded on purpose: the cap is applied below, where the true count is still available.
    const matched = buildEventDigest(recording.value, {
      fromMs: window.value.fromMs,
      toMs: window.value.toMs,
      ...(kinds.value ? { kinds: kinds.value } : {}),
      limit: Number.MAX_SAFE_INTEGER,
    }).events

    const truncated = matched.length > DIGEST_LIMIT

    return json({
      fromMs: window.value.fromMs,
      toMs: window.value.toMs,
      events: truncated ? matched.slice(0, DIGEST_LIMIT) : matched,
      totalMatched: matched.length,
      truncated,
      ...(truncated
        ? {
            note:
              `Showing the earliest ${DIGEST_LIMIT} of ${matched.length} matching events. To see the rest, ` +
              `either narrow the window (call again with from: ${matched[DIGEST_LIMIT]?.atMs ?? window.value.fromMs}) ` +
              'or pass a shorter "kinds" list.',
          }
        : {}),
    })
  },
}
