'use client'

import { useEffect, useState } from 'react'
import { formatSeconds } from '@/components/ui/format-time'
import { sessionActions, useSessionStore } from '@/lib/store/session'
import type { BisectStep } from '@/types/domain'
import { anchorFor, percentOf } from './axis'

/**
 * The binary search, drawn.
 *
 * The most persuasive four seconds of the demo, and the reason to build it properly. Each probe
 * appears in order, the searched window visibly halves, and the answer converges on a millisecond.
 * A viewer who has never heard of WebMCP watches a search happen inside a web page and understands
 * immediately that the agent is not fetching an answer from somewhere — it is making the page compute
 * one.
 *
 * Animate in trace order with a short stagger (~80ms). Rendering all ten probes at once shows the
 * result but not the search, which is the part worth showing.
 *
 * What shipped, and why:
 *   - one dot per probe, in three treatments: filled bright for true, filled dim for false, and a hollow
 *     ring for `elementMissing`. That last one is a different claim — "there was nothing to ask about"
 *     rather than "the answer was no" — and merging the two is how a report ends up describing an element
 *     appearing as a state change.
 *   - the funnel: after each probe, the interval that survived, folded from the trace. Successive windows
 *     are narrower and fainter, and the one that survived every probe is drawn once more in the agent's
 *     amber with its millisecond value. The store keeps only the trace, so the bracket is derived here.
 *   - the entrance is staggered in trace order, and skipped entirely under `prefers-reduced-motion`
 *   - the reveal restarts when the trace changes. `setBisectTrace` replaces the array wholesale for exactly
 *     this reason, so the effect keyed on the trace object is the intended signal.
 *   - a probe is clickable, like everything else on this axis: it seeks to the instant the agent probed, so
 *     "why did it decide that?" is one click rather than a re-run
 *
 * Amber, not the UI's sky accent, for the answer: a bisect is entirely the agent's work, and `AuthorBadge`
 * has already spent amber on the agent everywhere else. The probes themselves stay monochrome so the one
 * coloured thing in the band is the conclusion.
 */

/** One probe every 80ms. Fast enough to feel like a search, slow enough to count the steps. */
const STAGGER_MS = 80

/** The band, in pixels from its own top. 40px total, shared with nothing else — see Timeline's budget. */
const ROWS_TOP_PX = 2
const ROWS_HEIGHT_PX = 17
const ROW_PITCH_MAX_PX = 3
const DOTS_TOP_PX = 22
const LABEL_TOP_PX = 30

/** The interval that has survived so far. Either bound is null until a probe has established it. */
type SurvivingWindow = { from: number | null; to: number | null }

/**
 * Fold the trace into the window standing after each probe.
 *
 * `max(atMs where !result)` and `min(atMs where result)` — the same two numbers `BisectResult` reports as
 * `lastFalse` and `firstTrue`, recomputed because only the trace reaches the store. An `elementMissing`
 * probe counts as a lower bound: it evaluated false, whatever the reason.
 */
function survivingWindows(steps: BisectStep[]): SurvivingWindow[] {
  let from: number | null = null
  let to: number | null = null

  return steps.map((step) => {
    if (step.result) to = to === null ? step.atMs : Math.min(to, step.atMs)
    else from = from === null ? step.atMs : Math.max(from, step.atMs)
    return { from, to }
  })
}

/**
 * Reveal the trace one probe at a time, or all at once when the human has asked for less motion.
 *
 * Progressive rather than a CSS delay per dot, because the funnel is derived from the revealed prefix: one
 * count drives the dots, the brackets and whether the answer is on screen yet, so the drawing can never be
 * a step ahead of the search it is claiming to show.
 */
function useRevealedCount(trace: BisectStep[]): number {
  const [revealed, setRevealed] = useState(0)
  const reducedMotion = usePrefersReducedMotion()

  useEffect(() => {
    if (trace.length === 0) {
      setRevealed(0)
      return
    }
    if (reducedMotion) {
      setRevealed(trace.length)
      return
    }

    // The first probe lands immediately: an empty band for 80ms reads as the component failing to draw.
    let count = 1
    setRevealed(count)

    const timer = setInterval(() => {
      count += 1
      setRevealed(count)
      if (count >= trace.length) clearInterval(timer)
    }, STAGGER_MS)

    return () => clearInterval(timer)
  }, [trace, reducedMotion])

  return revealed
}

/**
 * Whether the human has asked for less motion.
 *
 * Starts false, which is what the first paint has to assume — every page here is prerendered at build
 * time, and there is no media query to read then. The effect corrects it before the second probe would
 * have appeared, so the worst case under reduced motion is a single dot rather than an animation.
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(query.matches)

    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return reduced
}

export function BisectTrace() {
  const trace = useSessionStore((s) => s.bisectTrace)
  const recording = useSessionStore((s) => s.recording)
  const revealed = useRevealedCount(trace)

  if (!recording || trace.length === 0) return null

  const steps = trace.slice(0, revealed)
  const windows = survivingWindows(steps)
  const converged = windows.length > 0 ? windows[windows.length - 1] : undefined
  const isComplete = revealed >= trace.length

  /** Only the history rows. The window that survived everything is drawn separately, as the answer. */
  const historyRows = windows.slice(0, Math.max(windows.length - 1, 0))
  const pitch =
    historyRows.length > 1
      ? Math.min(ROW_PITCH_MAX_PX, ROWS_HEIGHT_PX / (historyRows.length - 1))
      : ROW_PITCH_MAX_PX

  const spanOf = (bracket: SurvivingWindow) =>
    bracket.from === null || bracket.to === null
      ? null
      : {
          left: percentOf(bracket.from, recording.durationMs),
          right: percentOf(recording.durationMs - bracket.to, recording.durationMs),
        }

  return (
    // Above the markers, below the playhead, and click-through except on the probes themselves.
    <div className="pointer-events-none absolute top-10 h-10 w-full">
      {historyRows.map((bracket, index) => {
        const span = spanOf(bracket)
        // Nothing is bounded until a probe has landed on each side of the answer. Drawing a bracket from
        // the edge of the panel would be inventing a bound the search never established.
        if (!span) return null

        return (
          <span
            key={`window-${index}`}
            aria-hidden
            className="absolute h-px bg-zinc-500"
            style={{
              top: ROWS_TOP_PX + index * pitch,
              left: span.left,
              right: span.right,
              // Narrower and fainter as the search closes in, so the funnel reads top to bottom.
              opacity: 0.75 - (index / Math.max(historyRows.length, 1)) * 0.45,
            }}
          />
        )
      })}

      {steps.map((step, index) => {
        const missing = step.elementMissing === true
        const outcome = missing ? 'the element was not in the document' : `${step.result}`

        return (
          <button
            key={`probe-${index}-${step.atMs}`}
            type="button"
            title={`probe ${index + 1} of ${trace.length} — ${formatSeconds(step.atMs)} (${step.atMs}ms) — ${outcome}`}
            aria-label={`Seek to probe ${index + 1} at ${formatSeconds(step.atMs)}, ${outcome}`}
            onClick={() => sessionActions().setCurrentTime(step.atMs, 'human')}
            className="pointer-events-auto absolute flex h-2 w-[9px] -translate-x-1/2 items-center justify-center"
            style={{ top: DOTS_TOP_PX, left: percentOf(step.atMs, recording.durationMs) }}
          >
            <span
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${
                missing
                  ? 'border border-zinc-400 bg-transparent'
                  : step.result
                    ? 'bg-zinc-100'
                    : 'bg-zinc-700'
              }`}
            />
          </button>
        )
      })}

      {/*
        The answer: the surviving bracket and the millisecond it converged on. Held back until the last
        probe has been drawn, so the reveal ends on the conclusion instead of starting with it.
      */}
      {isComplete && converged ? (
        <ConvergedAnswer bracket={converged} durationMs={recording.durationMs} />
      ) : null}
    </div>
  )
}

function ConvergedAnswer({
  bracket,
  durationMs,
}: {
  bracket: SurvivingWindow
  durationMs: number
}) {
  /**
   * Three outcomes, and the wording of each matters more than the drawing does. A search that never saw
   * the predicate hold, and one that saw it hold at the first probe, are both easy to read as "found it at
   * X" — and both would put a moment in the report that the search never established.
   */
  if (bracket.to === null) {
    return (
      <span
        title="Every probe evaluated false, so the predicate never held inside the probed range. The transition is outside it, or the predicate is wrong."
        className="absolute right-0 font-mono text-[9px] leading-none text-zinc-500"
        style={{ top: LABEL_TOP_PX }}
      >
        no transition in the probed range
      </span>
    )
  }

  const at = bracket.to
  const precisionMs = bracket.from === null ? null : at - bracket.from

  return (
    <>
      {bracket.from !== null ? (
        <span
          aria-hidden
          className="absolute h-1 bg-amber-400/70"
          style={{
            top: DOTS_TOP_PX + 8,
            left: percentOf(bracket.from, durationMs),
            right: percentOf(durationMs - at, durationMs),
          }}
        />
      ) : null}

      <span
        title={
          precisionMs === null
            ? `The predicate already held at the first probe (${at}ms), so this is the earliest time probed rather than the moment it changed.`
            : `The predicate was false at ${bracket.from}ms and true at ${at}ms: the change happened in the ${precisionMs}ms between them.`
        }
        className={`absolute whitespace-nowrap font-mono text-[9px] leading-none ${anchorFor(at, durationMs)}`}
        style={{ top: LABEL_TOP_PX, left: percentOf(at, durationMs) }}
      >
        <span className="text-amber-300">{formatSeconds(at)}</span>
        <span className="ml-1 text-zinc-500">
          {precisionMs === null ? 'already true — floor, not a change' : `±${precisionMs}ms`}
        </span>
      </span>
    </>
  )
}
