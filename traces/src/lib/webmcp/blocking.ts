import type { Gate, GateResult } from '@/types/domain'

/**
 * The human-in-the-loop gate.
 *
 * Contract: docs/tools.md#blocking-tools.
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
 * The ChatGPT in-app browser has since been measured at roughly 20 s before it severs the connection,
 * which is what `GATE_TIMEOUT_MS` is set against. Re-measure before targeting a different host.
 */

/**
 * Measured, not guessed. A 25 s gate lost a `propose_hypotheses` call outright: the ChatGPT in-app
 * browser severed the agent's control connection at roughly 20 s, so the host gave up before the gate
 * could hand back its ticket. The page had already rendered the card and the human's decision was
 * still recorded — the agent just never received either, which is the one outcome the contract exists
 * to prevent.
 *
 * 8 s sits far enough under that ceiling to survive a slower host, and costs nothing: a human who is
 * already looking at the screen answers inside it, and one who isn't was always going to arrive by
 * ticket. Raising this back up trades a guaranteed reply for a slightly shorter happy path.
 */
export const GATE_TIMEOUT_MS = 8_000

/** One tool call currently awaiting this question. An agent that polls produces several over time. */
type Waiter<T> = {
  settle: (result: GateResult<T>) => void
  timer: ReturnType<typeof setTimeout>
}

type PendingEntry<T> = {
  /**
   * Everyone awaiting this question *right now* — usually one, but a retry adds another, and a host
   * that reissues a call can add more. All of them get the same answer.
   */
  waiters: Waiter<T>[]
  /**
   * Set the instant the human acts, and deliberately kept even when nobody is listening.
   *
   * This is the part that makes the ticket contract real. The human frequently answers *between* two
   * polls: the first call has already returned `pending`, the retry hasn't arrived yet, and there is
   * no promise to resolve at that moment. Without somewhere to park the answer it is dropped, the
   * agent polls forever, and the UI shows a question the human already answered.
   */
  answer?: { value: T }
  createdAt: number
}

/** Tickets live for the tab's lifetime. There is no server, so there is nothing to expire against. */
const pending = new Map<string, PendingEntry<unknown>>()

function newTicket(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

/**
 * Attach one waiter to an existing question, and resolve either way.
 *
 * Shared by the first call and every retry, so both paths wait on the *same* question. Returns null
 * only when the ticket is unknown — the caller turns that into a readable tool error rather than a
 * silent hang.
 */
function wait<T>(ticket: string, timeoutMs: number): Promise<GateResult<T>> | null {
  const entry = pending.get(ticket) as PendingEntry<T> | undefined
  if (!entry) return null

  // The human answered while nobody was listening. Collect it and retire the ticket.
  if (entry.answer) {
    const { value } = entry.answer
    pending.delete(ticket)
    return Promise.resolve({ status: 'answered', value })
  }

  return new Promise<GateResult<T>>((resolve) => {
    const waiter: Waiter<T> = {
      settle: resolve,
      timer: setTimeout(() => {
        entry.waiters = entry.waiters.filter((candidate) => candidate !== waiter)
        // The question stays open; only this particular call gives up on it.
        resolve({ status: 'pending', ticket })
      }, timeoutMs),
    }
    entry.waiters.push(waiter)
  })
}

/**
 * Open a question and wait for a person.
 *
 * Resolves either way: with the answer if the human is quick, with `{ status: 'pending', ticket }` if
 * they aren't. The question itself outlives that timeout — the ticket is how the agent gets back to
 * it, and `answerGate` can still land on it long afterwards.
 */
export function createGate<T>(ticketPrefix: string, timeoutMs = GATE_TIMEOUT_MS): Gate<T> & { ticket: string } {
  const ticket = newTicket(ticketPrefix)
  const entry: PendingEntry<T> = { waiters: [], createdAt: Date.now() }
  pending.set(ticket, entry as PendingEntry<unknown>)

  // Non-null: the entry was just inserted, so `wait` cannot miss it.
  const promise = wait<T>(ticket, timeoutMs) as Promise<GateResult<T>>

  return { ticket, promise, resolve: (value: T) => void answerGate(ticket, value) }
}

/**
 * Deliver a human's answer to whichever gate is waiting on it.
 *
 * Called from UI code — the mark-point overlay, the hypothesis cards, the report draft. Returns false
 * when the ticket is unknown, which happens legitimately: the human may answer a question the agent
 * has already abandoned.
 *
 * A second call on the same ticket is ignored rather than delivered. Two clicks on one prompt is a
 * human being unsure, not two answers, and the agent has already been told the first one.
 */
export function answerGate<T>(ticket: string, value: T): boolean {
  const entry = pending.get(ticket) as PendingEntry<T> | undefined
  if (!entry || entry.answer) return false

  entry.answer = { value }
  const waiting = entry.waiters
  entry.waiters = []

  // Nobody listening: the answer stays parked on the entry until the agent polls with its ticket.
  if (waiting.length === 0) return true

  pending.delete(ticket)
  for (const waiter of waiting) {
    clearTimeout(waiter.timer)
    waiter.settle({ status: 'answered', value })
  }
  return true
}

/**
 * Wait again on an existing ticket, for the retry path.
 *
 * A retry attaches to the *same* question. Opening a new gate here is the subtle bug this exists to
 * avoid — the human answers the first prompt, the agent waits on the second, and both sides sit there
 * each believing the other is slow.
 */
export function retryGate<T>(ticket: string, timeoutMs = GATE_TIMEOUT_MS): Promise<GateResult<T>> | null {
  return wait<T>(ticket, timeoutMs)
}

/** Tickets still waiting. Useful in the inspector; also what the UI badge counts. */
export function pendingTickets(): string[] {
  return [...pending.keys()]
}
