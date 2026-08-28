import { isRecord } from '@/lib/replay/rrweb-events'
import type { Recording, RrwebEvent } from '@/types/domain'
import { type ToolDefinition, json } from '../tool-types'
import { currentRecording, optionalString, optionalWindow, truncate } from './tool-context'

/**
 * 'read_network' — see docs/tools.md#8-read_network for the full contract.
 *
 * This tool reads the raw custom events rather than the digest, and that is a deliberate exception to
 * "wrap the pure function". `lib/replay/event-digest` reports network activity through
 * `isNetworkFailureEvent`, which by construction matches only `ok === false` — so a digest-backed
 * `read_network` would answer "which requests were made" with "the ones that failed", and an agent
 * would conclude the checkout never called the provinces endpoint at all when in fact it called it and
 * got back an empty list with a 200. A tool that under-reports silently is the failure this project is
 * built to avoid, so the tag is read directly here. The right home for this is a
 * `collectNetworkRequests(recording)` in `lib/replay/rrweb-events.ts` next to the guard it mirrors;
 * that file belongs to another area this week, so it is noted rather than moved.
 *
 * **Bodies never cross this boundary** (docs/threat-model.md T4). `bodySummary` is forwarded only if
 * the recorder already summarised it — `"array, 0 items"`, a key list — and is never derived here from
 * anything resembling a body. A response body is both large and likely to hold personal data, which
 * are two independent reasons, either of which would be sufficient.
 */

/** rrweb's `EventType.Custom`. Hardcoded for the same reason lib/replay/rrweb-events.ts hardcodes it. */
const EVENT_TYPE_CUSTOM = 5

/**
 * The tag bugbait's recorder emits, exactly. Matched literally rather than by prefix: a near-miss tag
 * should show up as "no requests recorded", which is a visible problem, rather than being half-matched
 * into a payload shape this tool then misreads.
 */
const NETWORK_REQUEST_TAG = 'network-request'

/** Response budget, matching list_events and read_console. */
const REQUEST_LIMIT = 40
/** Both are recorder-supplied strings, so both are capped before they reach a context window. */
const URL_CHARS = 200
const BODY_SUMMARY_CHARS = 120

type NetworkRequest = {
  atMs: number
  method: string
  url: string
  status?: number
  ok?: boolean
  durationMs?: number
  /** Already a summary when it arrives. See the note at the top of this file. */
  bodySummary?: string
}

type NetworkEventData = { tag: string; payload: Record<string, unknown> }

function isNetworkRequestEvent(event: RrwebEvent): event is RrwebEvent & { data: NetworkEventData } {
  const { data } = event
  if (event.type !== EVENT_TYPE_CUSTOM || !isRecord(data)) return false
  if (data.tag !== NETWORK_REQUEST_TAG || !isRecord(data.payload)) return false
  return typeof data.payload.url === 'string'
}

/**
 * Every field except `url` is optional in practice, and absent fields are *omitted* rather than filled
 * with a default. A missing method rendered as `"GET"` is an invention, and an agent quoting it in a
 * bug report has been handed a fact nobody recorded.
 */
function toRequest(event: RrwebEvent & { data: NetworkEventData }, startedAt: number): NetworkRequest {
  const payload = event.data.payload
  const method = typeof payload.method === 'string' ? payload.method.toUpperCase() : 'unknown'
  const status = typeof payload.status === 'number' && Number.isFinite(payload.status) ? payload.status : undefined
  const durationMs =
    typeof payload.durationMs === 'number' && Number.isFinite(payload.durationMs)
      ? Math.round(payload.durationMs)
      : undefined
  const bodySummary = typeof payload.bodySummary === 'string' ? truncate(payload.bodySummary, BODY_SUMMARY_CHARS) : undefined

  return {
    atMs: event.timestamp - startedAt,
    method,
    url: truncate(String(payload.url), URL_CHARS),
    ...(status === undefined ? {} : { status }),
    ...(typeof payload.ok === 'boolean' ? { ok: payload.ok } : {}),
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(bodySummary === undefined ? {} : { bodySummary }),
  }
}

/** A request the agent should look at first: explicitly not ok, or a 4xx/5xx status. */
function isFailure(request: NetworkRequest): boolean {
  if (request.ok === false) return true
  return request.status !== undefined && request.status >= 400
}

function collectRequests(recording: Recording): NetworkRequest[] {
  return recording.events
    .filter(isNetworkRequestEvent)
    .map((event) => toRequest(event, recording.startedAt))
    .sort((left, right) => left.atMs - right.atMs)
}

export const readNetworkTool: ToolDefinition = {
  name: 'read_network',
  description: [
    'List the network requests the recorded page made inside a time window — method, URL, status code,',
    'duration — including the ones that succeeded, which is what makes it useful for "the request went',
    'out and came back empty" as well as "the request failed". Response bodies are never returned; when',
    'the recorder captured one you get a one-line summary such as "array, 0 items", which is often',
    'exactly the evidence that an empty dropdown was the server\'s fault rather than the page\'s.',
  ].join(' '),

  inputSchema: {
    type: 'object',
    properties: {
      from: {
        type: 'number',
        description:
          'Start of the window, in ms from the start of the recording. Defaults to 0. Example: 20000 to see only what was requested after the 20-second mark.',
      },
      to: {
        type: 'number',
        description:
          'End of the window, in ms from the start of the recording. Defaults to the end of the recording (durationMs from read_session_meta).',
      },
      filter: {
        type: 'string',
        description:
          'Case-insensitive substring the URL must contain, e.g. "provinces" or "/api/". Omit to see every request in the window.',
      },
    },
    additionalProperties: false,
  },

  async execute(args) {
    const recording = currentRecording()
    if (!recording.ok) return recording.response

    const window = optionalWindow(args, recording.value)
    if (!window.ok) return window.response

    const filter = optionalString(args, 'filter', 200)
    if (!filter.ok) return filter.response
    const needle = filter.value?.toLowerCase()

    const matched = collectRequests(recording.value)
      .filter((request) => request.atMs >= window.value.fromMs && request.atMs <= window.value.toMs)
      .filter((request) => needle === undefined || request.url.toLowerCase().includes(needle))

    const truncated = matched.length > REQUEST_LIMIT
    const kept = truncated
      ? // Failures survive the cap first; chronological order is then restored, since a request list is
        // read as a sequence. Array#sort is stable, so equal ranks keep their positions.
        [...matched]
          .sort((left, right) => Number(isFailure(right)) - Number(isFailure(left)))
          .slice(0, REQUEST_LIMIT)
          .sort((left, right) => left.atMs - right.atMs)
      : matched

    const failedCount = matched.filter(isFailure).length

    return json({
      fromMs: window.value.fromMs,
      toMs: window.value.toMs,
      ...(needle === undefined ? {} : { filter: filter.value }),
      requests: kept,
      totalMatched: matched.length,
      failedCount,
      truncated,
      ...(truncated
        ? {
            note:
              `${matched.length} requests matched and ${REQUEST_LIMIT} are shown, failures kept first. ` +
              'Narrow it with "filter" set to a URL fragment such as "/api/", or with a shorter from/to window.',
          }
        : {}),
      ...(matched.length === 0
        ? {
            note:
              'No network requests were recorded in this window. Either nothing was requested, or this ' +
              'recording was captured without network instrumentation — check counts.failedRequests from ' +
              'read_session_meta before concluding the page made no requests.',
          }
        : {}),
    })
  },
}
