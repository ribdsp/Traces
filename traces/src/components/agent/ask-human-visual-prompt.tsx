'use client'

import { useSessionStore } from '@/lib/store/session'

/**
 * The panel-side view of a question the agent cannot answer alone.
 *
 * Owner: Faiq. The clickable half lives in MarkPointOverlay, on the player.
 *
 * Split deliberately: the *question* belongs in the agent panel with everything else the agent said,
 * and the *answer* is given on the player, because the answer includes where the human clicked. One
 * component holding both would either put a click target on the panel — losing the timestamp, which is
 * the precise part of the answer — or put prose over the replay, which is the thing being looked at.
 *
 * When a question is pending, this is the most important thing on screen. Say what is being asked and
 * that the agent is waiting; a quiet card gets missed and the gate times out for no reason.
 */
export function AskHumanVisualPrompt() {
  const pendingAsk = useSessionStore((s) => s.pendingAsk)

  if (!pendingAsk) return null

  /**
   * TODO(faiq), Day 4:
   *   - "The agent is waiting for you" plus the question, prominently
   *   - a hint that the answer is given by clicking the player, with the hinted moment named if
   *     hintAtMs is set — people do not guess this on their own the first time
   *   - once answered, keep the question and its answer visible in the panel. The exchange is evidence
   *     of collaboration; erasing it loses the most distinctive interaction in the app
   *   - if the gate has timed out and the agent is retrying with a ticket, say so rather than silently
   *     dropping the card. A question that disappears looks like a bug, not a timeout
   */
  return (
    <section className="border-b border-amber-500/30 bg-amber-500/5 p-3">
      <h2 className="mb-1 text-[11px] uppercase tracking-wide text-amber-300">Agent needs your eyes</h2>
      <p className="text-xs text-zinc-200">{pendingAsk.question}</p>
      <p className="mt-1 text-[10px] text-zinc-500">Answer by clicking the moment on the player.</p>
    </section>
  )
}
