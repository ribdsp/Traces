'use client'

import { Eye } from 'lucide-react'
import { useEffect } from 'react'
import { formatSeconds } from '@/components/ui/format-time'
import { sessionActions, useSessionStore } from '@/lib/store/session'

/**
 * The overlay that turns a human's glance into structured data.
 *
 * Pairs with the `ask_human_visual` tool.
 *
 * While `pendingAsk` is set, the replay area becomes clickable: the human clicks the moment they are
 * talking about, and that click supplies `markedTimestamp` in the answer. That is the whole reason
 * the answer is structured rather than prose — the human is not describing a moment, they are
 * pointing at one, and a timestamp is a fact the agent can bisect around.
 *
 * Keep the overlay out of the way when there's no question pending. An always-on click target on the
 * player surprises people who were trying to scrub.
 *
 * What shipped, and why:
 *   - the stage dims and the question sits over it, so a waiting agent is impossible to miss
 *   - the marked moment is the playhead, shown live in the card. The stage is a *spatial* surface — a
 *     click on it names a place, not an instant — so the moment is set on the timeline, which this overlay
 *     deliberately does not cover, and the card's job is to say which timestamp is about to be sent.
 *   - a choice button is the answer: `answerAsk(id, { choice, markedTimestamp })`, then `clearAsk()`,
 *     which the store documents as a no-op after an answer rather than a second feed line
 *   - `hintAtMs` is named, with a way back to it after scrubbing away. The tool has already seeked there,
 *     so seeking again here would be a second agent-authored write for a playhead already in place.
 *   - **skip**, which calls `clearAsk()` — the dismissal path `ask_human_visual` handles, returning a
 *     readable error instead of leaving the agent to poll a ticket nothing will answer
 *   - 1..4 pick a choice, for driving this at demo speed. Escape is deliberately *not* skip: a dismissal
 *     fails the agent's call, which is too much to hang on a stray keypress.
 */
export function MarkPointOverlay() {
  const pendingAsk = useSessionStore((s) => s.pendingAsk)
  const currentTime = useSessionStore((s) => s.currentTime)

  /**
   * Digits pick a choice. Bound at the window rather than on the card so it works without the human having
   * clicked into the overlay first — they will be on the timeline, choosing the moment.
   */
  useEffect(() => {
    if (!pendingAsk) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return

      const index = Number(event.key) - 1
      if (!Number.isInteger(index) || index < 0 || index >= pendingAsk.choices.length) return

      const choice = pendingAsk.choices[index]
      if (choice === undefined) return

      event.preventDefault()
      const time = useSessionStore.getState().currentTime
      sessionActions().answerAsk(pendingAsk.id, { choice, markedTimestamp: time })
      sessionActions().clearAsk()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pendingAsk])

  if (!pendingAsk) return null

  const answer = (choice: string) => {
    sessionActions().answerAsk(pendingAsk.id, { choice, markedTimestamp: currentTime })
    sessionActions().clearAsk()
  }

  const hintAtMs = pendingAsk.hintAtMs
  const isAtHint = hintAtMs !== undefined && Math.abs(hintAtMs - currentTime) < 100

  return (
    /*
     * The backdrop dims and blocks the stage; it is not itself an answer target. A click that both dismisses
     * a dialog and submits a value is how someone answers a question they were only trying to read.
     */
    <div className="absolute inset-0 flex flex-col items-center justify-end bg-base/75 p-3">
      <div className="w-full max-w-lg border border-warn/40 bg-panel/95 p-3">
        {/* The same glyph `AskHumanVisualPrompt` puts on its heading: one question, two surfaces, one mark. */}
        <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-warn">
          <Eye aria-hidden size={12} strokeWidth={1.5} className="shrink-0" />
          The agent is waiting for you
        </p>

        <p className="mt-1 text-xs leading-relaxed text-ink">{pendingAsk.question}</p>

        {/*
          The timestamp is the part of this answer the agent can act on, so it is the one number in the card
          that is set in mono type and updates as the playhead moves.
        */}
        <p className="mt-2 flex items-baseline gap-1.5 text-[10px] text-muted">
          <span>marking</span>
          <span className="font-mono text-[11px] text-human">{formatSeconds(currentTime)}</span>
          <span>— click the timeline to mark a different moment</span>
        </p>

        {hintAtMs !== undefined ? (
          <p className="mt-1 text-[10px] text-muted">
            The agent suggested {formatSeconds(hintAtMs)}
            {isAtHint ? (
              ', where the playhead is now.'
            ) : (
              <>
                {'. '}
                <button
                  type="button"
                  onClick={() => sessionActions().setCurrentTime(hintAtMs, 'human')}
                  className="underline decoration-dotted hover:text-ink focus-visible:bg-raised focus-visible:text-ink focus-visible:outline-none"
                >
                  Go back there
                </button>
              </>
            )}
          </p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {pendingAsk.choices.map((choice, index) => (
            <button
              key={choice}
              type="button"
              onClick={() => answer(choice)}
              className="flex items-baseline gap-1 border border-line bg-raised px-2 py-1 text-xs text-ink hover:border-warn/60 focus-visible:border-warn focus-visible:outline-none"
            >
              <span className="font-mono text-[9px] text-faint">{index + 1}</span>
              {choice}
            </button>
          ))}

          {/*
            Right-aligned and quiet, but present. Without it the only way out of a question you cannot
            answer is to wait out the gate, and the agent learns nothing from the timeout.
          */}
          <button
            type="button"
            onClick={() => sessionActions().clearAsk()}
            title="Close the question without answering. The agent is told you skipped it."
            className="ml-auto px-1 text-[10px] uppercase tracking-wide text-muted hover:text-ink focus-visible:bg-raised focus-visible:text-ink focus-visible:outline-none"
          >
            skip
          </button>
        </div>
      </div>
    </div>
  )
}
