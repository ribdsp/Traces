import type { SessionState } from '@/types/domain'
import { useSessionStore } from '@/lib/store/session'
import { retryGate } from '../blocking'
import { type JsonSchemaNode, type ToolResponse, json, toolError } from '../tool-types'

/**
 * Shared plumbing for the seven tools Vicko owns: argument reading, budgets, and the ticket/retry
 * half of the blocking contract.
 *
 * Owner: Vicko. Not a tool — `index.ts` never imports this — but the four blocking tools would
 * otherwise each carry their own copy of the retry path, and four copies of a timing contract is four
 * chances to get it subtly different. The one that matters is `collectRetry`: a retry must attach to
 * the *same* question through `retryGate`, never open a second one.
 */

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

/** A timeline marker's label is one line under a pin. Past this it is unreadable on screen. */
export const MARKER_LABEL_MAX = 80

/**
 * Shorten model prose to a budget, on one line.
 *
 * Returns the flag as well as the text so the caller can turn truncation into an *instruction* — "say
 * less next time" — rather than only reporting that something was cut.
 */
export function capText(value: string, max: number): { text: string; truncated: boolean } {
  const flat = value.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return { text: flat, truncated: false }
  return { text: `${flat.slice(0, Math.max(1, max - 1))}…`, truncated: true }
}

/** Keep the first `max` entries of a model-supplied list, and say whether anything was dropped. */
export function capList<T>(items: readonly T[], max: number): { items: T[]; truncated: boolean } {
  if (items.length <= max) return { items: [...items], truncated: false }
  return { items: items.slice(0, max), truncated: true }
}

// ---------------------------------------------------------------------------
// Untrusted arguments
// ---------------------------------------------------------------------------

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

/** An optional string: absent or null is fine, the wrong type is not. */
export function optionalString(args: Record<string, unknown>, key: string): Parsed<string | null> {
  const value = args[key]
  if (value === undefined || value === null) return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false, error: `'${key}', when given, must be a string.` }
  return { ok: true, value }
}

/** An optional number, rejecting NaN and Infinity along with the wrong type. */
export function optionalNumber(args: Record<string, unknown>, key: string): Parsed<number | null> {
  const value = args[key]
  if (value === undefined || value === null) return { ok: true, value: null }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, error: `'${key}', when given, must be a finite number of milliseconds.` }
  }
  return { ok: true, value }
}

/**
 * A required array of JSON objects.
 *
 * Arrays of primitives, nulls and nested arrays are all rejected by name, because the recovery a model
 * needs to hear is "each entry is an object with these fields", not "invalid input".
 */
export function requireObjectArray(
  args: Record<string, unknown>,
  key: string,
): Parsed<Record<string, unknown>[]> {
  const value = args[key]
  if (!Array.isArray(value)) {
    return { ok: false, error: `'${key}' is required and must be an array of objects.` }
  }

  const entries: Record<string, unknown>[] = []
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { ok: false, error: `'${key}[${index}]' must be an object, not ${describeType(entry)}.` }
    }
    entries.push(entry as Record<string, unknown>)
  }

  return { ok: true, value: entries }
}

function describeType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return `a ${typeof value}`
}

/**
 * Clamp a recording-relative time into the recording.
 *
 * A timestamp past the end is not an error worth refusing — models routinely round up past the last
 * event — but silently keeping it produces a playhead nobody can see and a marker off the end of the
 * timeline, so the caller is told what the number became.
 */
export function clampToRecording(atMs: number, durationMs: number): { atMs: number; clamped: boolean } {
  const bounded = Math.max(0, Math.min(atMs, durationMs))
  return { atMs: Math.round(bounded), clamped: Math.round(bounded) !== Math.round(atMs) }
}

// ---------------------------------------------------------------------------
// The ticket half of the blocking contract
// ---------------------------------------------------------------------------

/**
 * The `ticket` field, worded identically on all four blocking tools.
 *
 * "Do not invent one" is load-bearing: a model that guesses a ticket gets an error naming a ticket it
 * has never seen, and the readable version of that error is what stops it guessing again.
 */
export const TICKET_FIELD: JsonSchemaNode = {
  type: 'string',
  description:
    'Only when retrying a call that previously returned status "pending". Do not invent one — pass back exactly the ticket you were given, e.g. "ask-1a2b3c4d".',
}

/**
 * The `pending` reply.
 *
 * `pending` is a conversation, not a failure, so it is a normal response rather than an error and it
 * says three things the agent acts on: the human is still looking, retry *with the ticket*, and don't
 * poll tightly. Without the middle sentence a model helpfully starts a second question, which is the
 * exact failure the ticket exists to prevent.
 */
export function pendingResponse(toolName: string, ticket: string, waitingOn: string): ToolResponse {
  return json({
    status: 'pending',
    ticket,
    waitingOn,
    nextStep:
      `The human is still looking at this. Call ${toolName} again with ticket "${ticket}" to reattach to ` +
      'the same open question — calling without the ticket would start a second one, which they will ' +
      'never see. Leave a few seconds between retries rather than polling tightly, and tell the user ' +
      'you are waiting on them.',
  })
}

/** A ticket the gate does not recognise: expired, already collected, or invented. */
export function unknownTicketError(toolName: string, ticket: string): ToolResponse {
  return toolError(
    `Ticket "${ticket}" is not open: either its answer was already collected, or the page was reloaded ` +
      `since it was issued. Nothing is waiting on it. Call ${toolName} again without a ticket to start a ` +
      'fresh request.',
  )
}

/**
 * The retry path, shared by every blocking tool.
 *
 * Attaches to the existing question through `retryGate` — never `createGate`. Three outcomes, and the
 * caller only has to handle one of them: `value` when the human has acted, and a ready-made response
 * for the other two.
 */
export async function collectRetry<T>(
  toolName: string,
  ticket: string,
  waitingOn: string,
): Promise<{ kind: 'value'; value: T } | { kind: 'response'; response: ToolResponse }> {
  const promise = retryGate<T>(ticket)
  if (promise === null) {
    return { kind: 'response', response: unknownTicketError(toolName, ticket) }
  }

  const result = await promise
  if (result.status === 'pending') {
    return { kind: 'response', response: pendingResponse(toolName, result.ticket, waitingOn) }
  }

  return { kind: 'value', value: result.value }
}

// ---------------------------------------------------------------------------
// The store half: watching for the human to act
// ---------------------------------------------------------------------------

/**
 * Watch the store until the human's action shows up, then deliver it once.
 *
 * This is the bridge the store cannot build for itself: `lib/store` imports nothing from
 * `lib/webmcp`, and the reverse of that would be a cycle, so the UI's actions land in state and
 * *this* is what notices and resolves the gate.
 *
 * It deliberately outlives the gate's timeout. The human very often acts between two polls, when no
 * tool call is outstanding at all; `answerGate` parks the answer on the ticket for the next retry, and
 * that only works if something is still watching by then.
 */
export function watchForHuman<T>(
  detect: (state: SessionState) => T | null,
  deliver: (value: T) => void,
): () => void {
  let settled = false
  /**
   * Re-entrancy guard. `detect` is allowed to write to the store — `claim_next_task`'s detector claims
   * the task it found, because checking and claiming have to be one step — and that write notifies
   * subscribers again from inside this listener. Without the guard the nested pass would run the
   * detector a second time and could claim a *second* task on behalf of one waiting call.
   */
  let running = false
  let unsubscribe: (() => void) | null = null

  const cancel = (): void => {
    settled = true
    unsubscribe?.()
  }

  unsubscribe = useSessionStore.subscribe((state) => {
    if (settled || running) return
    running = true
    try {
      const value = detect(state)
      if (value === null) return
      cancel()
      deliver(value)
    } finally {
      running = false
    }
  })

  return cancel
}
