'use client'

import { useEffect, useRef, useState } from 'react'
import { AuthorBadge } from '@/components/ui/author-badge'
import { formatSeconds } from '@/components/ui/format-time'
import { useWallClock } from '@/components/ui/use-clock'
import { GATE_TIMEOUT_MS } from '@/lib/webmcp/blocking'
import { useSessionStore } from '@/lib/store/session'

/**
 * The panel-side view of a question the agent cannot answer alone.
 *
 * The clickable half lives in MarkPointOverlay, on the player.
 *
 * Split deliberately: the *question* belongs in the agent panel with everything else the agent said,
 * and the *answer* is given on the player, because the answer includes where the human clicked. One
 * component holding both would either put a click target on the panel — losing the timestamp, which is
 * the precise part of the answer — or put prose over the replay, which is the thing being looked at.
 *
 * When a question is pending, this is the most important thing on screen. Say what is being asked and
 * that the agent is waiting; a quiet card gets missed and the gate times out for no reason.
 *
 * What shipped, and why:
 *   - the question, that the agent is waiting, how long it has been waiting, and that the answer is given
 *     on the player — naming `hintAtMs` when the agent suggested somewhere to look
 *   - past `GATE_TIMEOUT_MS` the card says the first call has already returned a ticket and that answering
 *     still works. A question that quietly stops mattering after 25 seconds reads as a bug; this one has to
 *     say that the agent is retrying and the human is not too late.
 *   - the exchange survives being answered. `pendingAsk` is cleared by `answerAsk`, the answer itself is
 *     consumed by the tool, and `SessionState` has nowhere to keep either — so the question is held here
 *     while it is open and paired with the store's own outcome line once it closes. Erasing it would erase
 *     the most distinctive thing in the app at the moment it finally happened.
 */

/** The store's wording for the two outcomes, from `answerAsk` and `clearAsk`. */
const ANSWERED = /^answered "/
const DISMISSED = /^dismissed the question "/

/**
 * How far back to look for the outcome line.
 *
 * Not just the last entry: answering drops a human-authored marker at the marked moment, and that happens
 * synchronously inside the tool's store subscription — so by the time this effect runs, the newest line is
 * usually the marker rather than the answer.
 */
const TAIL = 6

type Exchange = {
  question: string
  /** The store's own line, so the panel and the feed cannot disagree about what happened. */
  outcome: string
  answered: boolean
}

export function AskHumanVisualPrompt() {
  const pendingAsk = useSessionStore((s) => s.pendingAsk)
  const [resolved, setResolved] = useState<Exchange | null>(null)
  const openQuestion = useRef<string | null>(null)

  /** Only while a question is open, and only as fine as the label it feeds. */
  const now = useWallClock(1_000)

  useEffect(() => {
    if (pendingAsk !== null) {
      openQuestion.current = pendingAsk.question
      setResolved(null)
      return
    }

    const question = openQuestion.current
    if (question === null) return
    openQuestion.current = null

    // Read imperatively: `answerAsk` writes the outcome line and clears the slot in one update, so the
    // committed state this effect is reacting to already contains the line — but a subscribed `activity`
    // would also re-run this effect on every unrelated feed entry afterwards.
    const activity = useSessionStore.getState().activity
    const tail = activity.slice(Math.max(activity.length - TAIL, 0)).reverse()
    const line = tail.find(
      (entry) => ANSWERED.test(entry.description) || DISMISSED.test(entry.description),
    )

    setResolved({
      question,
      outcome: line?.description ?? 'closed without an answer',
      answered: line !== undefined && ANSWERED.test(line.description),
    })
  }, [pendingAsk])

  if (pendingAsk) {
    const waitedMs = now === null ? 0 : Math.max(now - pendingAsk.askedAt, 0)
    const timedOut = waitedMs > GATE_TIMEOUT_MS

    return (
      <section className="border-b border-amber-500/30 bg-amber-500/5 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[11px] uppercase tracking-wide text-amber-300">
            Agent needs your eyes
          </h2>
          <span className="shrink-0 font-mono text-[10px] text-zinc-500">
            waiting {Math.round(waitedMs / 1000)}s
          </span>
        </div>

        <p className="mt-1 text-xs leading-relaxed text-zinc-100">{pendingAsk.question}</p>

        <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
          Answer on the player: put the playhead on the moment you mean, then pick one of the options over
          the replay.
          {pendingAsk.hintAtMs !== undefined
            ? ` The agent suggested ${formatSeconds(pendingAsk.hintAtMs)}.`
            : ''}
        </p>

        {timedOut ? (
          <p className="mt-1.5 border-l border-amber-500/40 pl-2 text-[10px] leading-relaxed text-amber-200/80">
            The agent’s call has already returned — it waited {Math.round(GATE_TIMEOUT_MS / 1000)}s and got a
            ticket back, so it is retrying rather than sitting still. Your answer still reaches it.
          </p>
        ) : null}
      </section>
    )
  }

  if (resolved === null) return null

  /*
   * The exchange, after the fact. Kept in the same slot the question occupied so the panel does not reflow
   * the moment it is answered, and quiet enough that it stops competing with whatever the agent does next.
   */
  return (
    <section className="border-b border-zinc-800 p-3">
      <h2 className="text-[11px] uppercase tracking-wide text-zinc-500">
        {resolved.answered ? 'You answered the agent' : 'You skipped the agent’s question'}
      </h2>

      <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">{resolved.question}</p>

      <p className="mt-1 flex flex-wrap items-baseline gap-1 text-[11px] text-zinc-200">
        <span>{resolved.outcome}</span>
        <AuthorBadge author="human" />
      </p>

      {resolved.answered ? (
        <p className="mt-1 text-[10px] text-zinc-600">
          The moment you marked is now a marker on the timeline, and the agent has the timestamp.
        </p>
      ) : (
        <p className="mt-1 text-[10px] text-zinc-600">
          The agent was told you skipped it, rather than being left waiting.
        </p>
      )}
    </section>
  )
}
