'use client'

import { sessionActions, useSessionStore } from '@/lib/store/session'

/**
 * The overlay that turns a human's glance into structured data.
 *
 * Owner: Faiq. Pairs with the `ask_human_visual` tool.
 *
 * While `pendingAsk` is set, the replay area becomes clickable: the human clicks the moment they are
 * talking about, and that click supplies `markedTimestamp` in the answer. That is the whole reason
 * the answer is structured rather than prose — the human is not describing a moment, they are
 * pointing at one, and a timestamp is a fact the agent can bisect around.
 *
 * Keep the overlay out of the way when there's no question pending. An always-on click target on the
 * player surprises people who were trying to scrub.
 */
export function MarkPointOverlay() {
  const pendingAsk = useSessionStore((s) => s.pendingAsk)
  const currentTime = useSessionStore((s) => s.currentTime)

  if (!pendingAsk) return null

  /**
   * TODO(faiq), Day 4:
   *   - dim the stage slightly and show the question over it, so it is obvious the agent is waiting
   *   - a click anywhere marks the current playhead position; a click on the timeline marks that
   *     point instead. Both paths end at answerAsk
   *   - answerAsk(pendingAsk.id, { choice, markedTimestamp }) then clearAsk — the tool's gate resolves
   *     from there
   *   - an explicit "skip" that answers rather than closes silently. A dismissed question that never
   *     resolves leaves the agent waiting on a gate until it times out
   */
  const answer = (choice: string) => {
    sessionActions().answerAsk(pendingAsk.id, { choice, markedTimestamp: currentTime })
    sessionActions().clearAsk()
  }

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-end gap-2 bg-zinc-950/60 p-4">
      <p className="max-w-md text-center text-xs text-zinc-200">{pendingAsk.question}</p>
      <div className="flex gap-2">
        {pendingAsk.choices.map((choice) => (
          <button
            key={choice}
            type="button"
            onClick={() => answer(choice)}
            className="border border-zinc-700 px-2 py-1 text-xs text-zinc-300"
          >
            {choice}
          </button>
        ))}
      </div>
    </div>
  )
}
