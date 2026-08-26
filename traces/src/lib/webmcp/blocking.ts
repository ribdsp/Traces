import type { Gate, GateResult } from '@/types/domain'

/**
 * The human-in-the-loop gate.
 *
 * Owner: Vicko. Contract: docs/tools.md#blocking-tools.
 *
 * Four tools don't return until a person acts — `claim_next_task`, `ask_human_visual`,
 * `propose_hypotheses`, `propose_report`. That is the mechanism behind the claim that the human is a
 * tool inside the agent's loop rather than a spectator watching it work.
 *
 * The hard part isn't waiting, it's the tolerance of whichever host is running the agent. Nobody
 * publishes how long a pending tool call is allowed to stay pending, and the answer differs between
 * the ChatGPT in-app browser, an extension inspector, and a bare Chrome tab. So the contract is:
 * **never leave a call unresolved.** Resolve with the answer if the human is quick, and with a ticket
 * if they aren't. The agent then retries with the ticket, which reads to the model as a normal
 * polling loop rather than a broken page.
 *
 * Spike S1 on Day 1 measures the real tolerance; write the number into internal/PLAN.md and set
 * GATE_TIMEOUT_MS to comfortably under it.
 */

/**
 * TODO(vicko), Day 1: replace with the measured value from S1, minus a healthy margin.
 * 25s is a guess chosen to be survivable rather than correct — it is not a measurement.
 */
export const GATE_TIMEOUT_MS = 25_000

type PendingEntry<T> = {
  resolve: (value: T) => void
  /** Kept so a retry can wait on the same promise instead of opening a second question. */
  promise: Promise<GateResult<T>>
  createdAt: number
}

/** Tickets live for the tab's lifetime. There is no server, so there is nothing to expire against. */
const pending = new Map<string, PendingEntry<unknown>>()

function newTicket(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

/**
 * Create a gate that resolves either way.
 *
 * Resolves once and only once: whichever of the human and the timeout arrives first wins, the timer
 * is cleared, and a late `resolve()` is a no-op rather than a second reply to a model that has
 * already moved on.
 */
export function createGate<T>(ticketPrefix: string, timeoutMs = GATE_TIMEOUT_MS): Gate<T> & { ticket: string } {
  const ticket = newTicket(ticketPrefix)

  let settle: ((result: GateResult<T>) => void) | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const promise = new Promise<GateResult<T>>((resolve) => {
    settle = resolve
    timer = setTimeout(() => {
      if (!settle) return
      settle = null
      resolve({ status: 'pending', ticket })
    }, timeoutMs)
  })

  const resolveWith = (value: T) => {
    if (!settle) return
    if (timer !== null) clearTimeout(timer)
    const done = settle
    settle = null
    pending.delete(ticket)
    done({ status: 'answered', value })
  }

  pending.set(ticket, {
    resolve: resolveWith as (value: unknown) => void,
    promise: promise as Promise<GateResult<unknown>>,
    createdAt: Date.now(),
  })

  return { ticket, promise, resolve: resolveWith }
}

/**
 * Deliver a human's answer to whichever gate is waiting on it.
 *
 * Called from UI code — the mark-point overlay, the hypothesis cards, the report draft. Returns false
 * when the ticket is unknown, which happens legitimately: the human may answer a question the agent
 * has already abandoned.
 */
export function answerGate<T>(ticket: string, value: T): boolean {
  const entry = pending.get(ticket)
  if (!entry) return false
  entry.resolve(value)
  return true
}

/**
 * Wait again on an existing ticket, for the retry path.
 *
 * TODO(vicko), Day 4: a retry has to attach to the *same* question. Opening a new gate on retry is
 * the subtle bug here — the human answers the first prompt, the agent is waiting on the second, and
 * both sides sit there each believing the other is slow.
 */
export function retryGate<T>(_ticket: string, _timeoutMs = GATE_TIMEOUT_MS): Promise<GateResult<T>> | null {
  throw new Error('retryGate: not implemented')
}

/** Tickets still waiting. Useful in the inspector; also what the UI badge counts. */
export function pendingTickets(): string[] {
  return [...pending.keys()]
}
