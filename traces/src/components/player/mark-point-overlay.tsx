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
 *   - the card is the most raised thing on the screen while it is up — a radius, an inset highlight and an
 *     amber border — because it is a dialog over a live document rather than a panel beside one. The dot
 *     next to the heading is the same signal `AskHumanVisualPrompt` shows in the agent column: one gate,
 *     two surfaces, one vocabulary.
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
    <div className="absolute inset-0 flex flex-col items-center justify-end bg-base/80 p-3">
      <div className="w-full max-w-lg rounded-md border border-warn/40 bg-panel p-3 shadow-raised">
        <div className="flex items-start gap-2.5">
          {/* The same glyph `AskHumanVisualPrompt` puts on its heading: one question, two surfaces, one mark. */}
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-warn/15 text-warn">
            <Eye aria-hidden size={15} strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-warn">
              The agent is waiting for you
              {/*
                Degrades to a solid dot: `globals.css` zeroes animation duration under `prefers-reduced-motion`,
                which settles `animate-pulse` on opacity 1. The sentence it sits beside is what actually carries
                the meaning, so nothing is lost when the motion is.
              */}
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-warn" />
            </p>
            <p className="mt-1 text-body leading-relaxed text-ink">{pendingAsk.question}</p>
          </div>
        </div>

        {/*
          The timestamp is the part of this answer the agent can act on, so it is the one number in the card
          that is set in mono type and updates as the playhead moves. `tabular-nums` because it does update:
          proportional digits make a live counter jitter sideways.
        */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border border-line bg-raised/60 px-2 py-1.5 text-meta text-muted">
          <span>marking</span>
          <span className="rounded-sm bg-human/15 px-1.5 py-px font-mono text-body tabular-nums text-human">
            {formatSeconds(currentTime)}
          </span>
          <span>click the timeline to pick a different moment</span>
        </div>

        {hintAtMs !== undefined ? (
          <p className="mt-1.5 text-meta text-muted">
            The agent suggested {formatSeconds(hintAtMs)}
            {isAtHint ? (
              ', where the playhead is now.'
            ) : (
              <>
                {'. '}
                <button
                  type="button"
                  onClick={() => sessionActions().setCurrentTime(hintAtMs, 'human')}
                  className="rounded-sm underline decoration-dotted hover:text-ink focus-visible:bg-raised focus-visible:text-ink"
                >
                  Go back there
                </button>
              </>
            )}
          </p>
        ) : null}

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {pendingAsk.choices.map((choice, index) => (
            <button
              key={choice}
              type="button"
              onClick={() => answer(choice)}
              className="flex items-center gap-1.5 rounded-sm border border-line-strong bg-raised px-2 py-1.5 text-body text-ink shadow-raised hover:border-warn/70 hover:bg-warn/5 focus-visible:border-warn"
            >
              {/* 10px is below the type floor and allowed to be: it is a key cap, not text to read. */}
              <span className="flex h-4 w-4 items-center justify-center rounded-sm bg-base font-mono text-micro text-muted">
                {index + 1}
              </span>
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
            className="ml-auto rounded-sm px-1.5 py-1 text-label uppercase tracking-wide text-muted hover:bg-raised hover:text-ink focus-visible:bg-raised focus-visible:text-ink"
          >
            skip
          </button>
        </div>
      </div>
    </div>
  )
}
