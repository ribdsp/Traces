import { getActiveEngine, type ReplayEngine } from '@/lib/replay/replay-engine'
import { sessionState } from '@/lib/store/session'
import type { Recording } from '@/types/domain'
import { noRecording, requireNumber, toolError, type ToolResponse } from '../tool-types'

/**
 * The plumbing every read/search tool repeats: reach the recording, reach the replay engine, turn an
 * argument into a validated recording-relative time, and position the replay so the mirror document
 * can be read.
 *
 * Owner: Vicko. It lives here rather than in `lib/` on purpose — none of it is logic, all of it is
 * *argument handling and failure phrasing at the WebMCP boundary*, which is the one thing a tool
 * wrapper is allowed to own. `lib/` stays free of the store, the engine handle and `ToolResponse`.
 *
 * The reason it is shared rather than copied nine times is narrower than "don't repeat yourself": the
 * error sentences are the interface. Nine hand-written variants of "the player has not mounted yet"
 * teach a model nine different things about the same condition, and the one an agent happens to hit
 * decides whether it retries or gives up.
 */

export type Attempt<T> = { ok: true; value: T } | { ok: false; response: ToolResponse }

function rejected<T>(message: string): Attempt<T> {
  return { ok: false, response: toolError(message) }
}

/**
 * The loaded recording, or the standard "no recording" reply.
 *
 * Tools stay registered when nothing is loaded (docs/tools.md § Error behaviour): a capability that
 * disappears from the tool list looks to an agent like a capability that never existed.
 */
export function currentRecording(): Attempt<Recording> {
  const { recording } = sessionState()
  if (recording === null) return { ok: false, response: noRecording() }
  return { ok: true, value: recording }
}

/**
 * The engine, or an instruction to retry.
 *
 * `null` means the player component has not mounted yet, which is a *timing* condition and not a bad
 * argument — so the message says to retry rather than describing a fault. An agent handed a stack
 * trace here reports a broken page; an agent handed this sentence calls again a second later and
 * succeeds.
 *
 * Called *after* a tool has validated its arguments, never before: answering a malformed call with
 * "the player is still mounting, try again" gets the same malformed call back on the next turn.
 */
export function currentEngine(): Attempt<ReplayEngine> {
  const engine = getActiveEngine()
  if (engine === null) {
    return rejected(
      'The replay player has not finished mounting yet, so there is no reconstructed page to read. ' +
        'This is temporary: wait a moment and call this tool again. If it keeps happening, ask the ' +
        'human to open one of the sample recordings in the player.',
    )
  }
  return { ok: true, value: engine }
}

/**
 * A required recording-relative timestamp, rejected rather than clamped when it is out of range.
 *
 * Clamping would be friendlier and wrong: an agent that asks for 90,000 ms of a 47,000 ms recording
 * has a wrong model of the timeline, and silently answering about the last frame instead confirms
 * that wrong model with real-looking data. The message names the recording's length so the next call
 * is right.
 */
export function requireTimestamp(
  args: Record<string, unknown>,
  key: string,
  recording: Recording,
): Attempt<number> {
  const parsed = requireNumber(args, key)
  if (!parsed.ok) return rejected(parsed.error)
  if (parsed.value < 0 || parsed.value > recording.durationMs) {
    return rejected(
      `'${key}' is ${parsed.value} ms, which is outside this recording: it runs from 0 to ` +
        `${recording.durationMs} ms. Call read_session_meta for the duration, then retry with a value in range.`,
    )
  }
  return { ok: true, value: parsed.value }
}

/** An optional number, absent-or-finite. Present-but-wrong is an error; absent is not. */
export function optionalNumber(args: Record<string, unknown>, key: string): Attempt<number | undefined> {
  const value = args[key]
  if (value === undefined || value === null) return { ok: true, value: undefined }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return rejected(`'${key}' must be a finite number of milliseconds from the start of the recording, or omitted.`)
  }
  return { ok: true, value }
}

/** An optional non-empty string, length-capped so a runaway argument cannot become a runaway query. */
export function optionalString(
  args: Record<string, unknown>,
  key: string,
  maxLength = 200,
): Attempt<string | undefined> {
  const value = args[key]
  if (value === undefined || value === null) return { ok: true, value: undefined }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return rejected(`'${key}' must be a non-empty string, or omitted.`)
  }
  if (value.length > maxLength) {
    return rejected(`'${key}' is limited to ${maxLength} characters.`)
  }
  return { ok: true, value }
}

export type TimeWindow = { fromMs: number; toMs: number }

/**
 * The `{ from?, to? }` window shared by list_events, read_console, read_network.
 *
 * Both ends default to the whole recording, because "everything" is the right first question and an
 * agent that has to supply a range before it knows the duration guesses one. An inverted window is
 * rejected instead of swapped: `from: 5000, to: 1000` is a mistake with two plausible repairs, and
 * picking one for the agent hides which it meant.
 */
export function optionalWindow(args: Record<string, unknown>, recording: Recording): Attempt<TimeWindow> {
  const from = optionalNumber(args, 'from')
  if (!from.ok) return from
  const to = optionalNumber(args, 'to')
  if (!to.ok) return to

  const fromMs = from.value ?? 0
  const toMs = to.value ?? recording.durationMs

  if (fromMs > toMs) {
    return rejected(
      `'from' (${fromMs} ms) is after 'to' (${toMs} ms), so the window is empty. Pass from <= to; the ` +
        `recording runs from 0 to ${recording.durationMs} ms.`,
    )
  }
  if (fromMs < 0) {
    return rejected(`'from' is ${fromMs} ms. Times are measured from the start of the recording, so 0 is the earliest.`)
  }
  return { ok: true, value: { fromMs, toMs } }
}

/**
 * Position the replay at `atMs` and hand back the reconstructed document.
 *
 * `mirrorDocument()` throws two different "not ready yet" errors (no `contentDocument`, or no seek has
 * happened) and both are recoverable by retrying — see the comments on `replay-engine.ts`. Neither may
 * reach the model as an exception, so they are caught here once, for every tool.
 */
export async function documentAt(engine: ReplayEngine, atMs: number): Promise<Attempt<Document>> {
  try {
    await engine.gotoTime(atMs)
    return { ok: true, value: engine.mirrorDocument() }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return rejected(
      `The replay could not be positioned at ${atMs} ms yet: ${detail} This is a timing problem rather ` +
        'than a bad argument — call the same tool again in a moment.',
    )
  }
}

/** The subtree a whole-page read starts from. `documentElement` is the fallback for a headless clone. */
export function rootOf(document: Document): Element {
  return document.body ?? document.documentElement
}

/**
 * Put the replay back where the human left it.
 *
 * Tools that probe several instants (bisect, find_element, diff_dom) leave the shared Replayer
 * wherever their last probe landed, and that Replayer is what the human is watching. Restoring the
 * playhead is not cosmetic: a player parked at a timestamp nobody chose reads as the agent having
 * broken the UI. Failures are swallowed deliberately — this runs after the answer is already computed,
 * and a repositioning error must not turn a good result into a tool error.
 */
export async function restorePlayhead(engine: ReplayEngine): Promise<void> {
  try {
    await engine.gotoTime(sessionState().currentTime)
  } catch {
    // Nothing to report: the answer is unaffected, and the human can scrub.
  }
}

/** Hard character cap for one field of a response. Suffixed so a clipped value never reads as complete. */
export function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`
}

/** Whitespace-collapsed, trimmed, capped. Text out of a recorded page is never returned raw. */
export function oneLine(value: string, limit: number): string {
  return truncate(value.replace(/\s+/g, ' ').trim(), limit)
}
