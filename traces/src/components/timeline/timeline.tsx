'use client'

import { Timer } from 'lucide-react'
import { useState } from 'react'
import { formatSeconds } from '@/components/ui/format-time'
import { sessionActions, useSessionStore } from '@/lib/store/session'
import { AnnotationMarker } from './annotation-marker'
import { anchorFor, percentOf, TIMELINE_HEIGHT_PX } from './axis'
import { BisectTrace } from './bisect-trace'
import { EventTrack } from './event-track'

/**
 * The shared timeline: one horizontal axis that both the human and the agent write to.
 *
 * This is the component that carries the collaboration claim. Everything the agent finds lands here,
 * on the same axis as everything the human noticed, colour-coded by author. Someone watching the demo
 * should be able to see, without narration, that two parties were working on one artefact.
 *
 * All positioning is a percentage of `durationMs`, never pixels. The panel is resizable and the demo
 * gets recorded at a different width than anyone develops at.
 *
 * What shipped, and why:
 *   - the layers stack in DOM order, seek button *first*. Children with no `z-index` paint in document
 *     order, so the full-area button being last was what made every layer above it unclickable and
 *     forced `AnnotationMarker`'s `z-10`. Putting it first is the fix; the `z-10` stays because it is
 *     harmless and removing it would be churn in a file that works.
 *   - every layer above the button is `pointer-events-none`, with `pointer-events-auto` restored on the
 *     things that are actually clickable. Without that, a decorative band spanning the full width
 *     swallows clicks meant for the axis, and the symptom looks like a broken `onClick`.
 *   - a two-weight ruler: labelled ticks through `formatSeconds`, and four unlabelled ticks between each
 *     pair. The minor ticks are what make the axis a *measure* rather than a row of numbers — they are how
 *     an eye interpolates "just after 14s" from a marker sitting between two labels, which is the reading
 *     this whole panel exists to support.
 *   - a hover guide with the time under the cursor, because checking an agent's claimed timestamp
 *     against the axis is the single most common act in this app and it should not cost a click
 *   - the playhead is a 1px rule with a handle in the ruler, above every band. It used to be a bare hairline
 *     among other hairlines: in a compressed recording it was indistinguishable from a tick, and where the
 *     playhead *is* is the one thing a viewer tracks continuously.
 *
 * The vertical budget is `TIMELINE_HEIGHT_PX` and every band has a fixed home, so two layers never land on
 * each other: ruler in the top 17px, markers at 20px (`MARKER_TOP_PX`, which `AnnotationMarker` reads), the
 * bisect funnel from 40px to 80px, and the event track in the bottom 24px.
 *
 * That budget went from 96px to 112px in the visual pass, which is 16px taken from the replay panel above.
 * Spent on the two bands a viewer actually reads at video resolution — the ruler's labels and the event
 * track's lozenges — and affordable because this strip is a `shrink-0` flex sibling of the split, so the
 * cost is 16px of replay height rather than a scrollbar. Checked at every width in the brief.
 */

/**
 * Label spacing, coarsened when 5s would crowd.
 *
 * Every sample recording is under a minute, so 5s is what this actually draws. The ladder exists
 * because a 10-minute recording would otherwise render 120 overlapping labels — unreadable, and the
 * kind of thing nobody notices until someone loads their own recording.
 */
const TICK_LADDER_MS = [5_000, 10_000, 30_000, 60_000] as const
const MAX_TICK_LABELS = 14

/** Past the ladder: one label every five minutes. A recording that long is not what this is for. */
const COARSEST_TICK_MS = 300_000

function tickIntervalFor(durationMs: number): number {
  for (const candidate of TICK_LADDER_MS) {
    if (durationMs / candidate <= MAX_TICK_LABELS) return candidate
  }
  return COARSEST_TICK_MS
}

/**
 * Unlabelled ticks between each labelled one.
 *
 * Five, so that at the usual 5s interval each minor tick is one second — the unit anyone reading this axis
 * is counting in. It also bounds the DOM: `MAX_TICK_LABELS` majors means at most 70 minor ticks, whatever
 * the recording's length.
 */
const MINOR_TICKS_PER_LABEL = 5

/** Evenly spaced decorative ticks for the empty axis. Percents, not milliseconds: there is no duration yet. */
const GHOST_TICKS = [0, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100] as const

/** Below this, a pointer move is not a new reading — it is the same instant, one pixel over. */
const HOVER_RESOLUTION_MS = 50

export function Timeline() {
  const recording = useSessionStore((s) => s.recording)
  const markers = useSessionStore((s) => s.markers)
  const currentTime = useSessionStore((s) => s.currentTime)
  const [hoverAtMs, setHoverAtMs] = useState<number | null>(null)

  /**
   * The empty state is a sentence rather than a blank bar. A grey strip under the player reads as a
   * timeline that failed to draw. Name the condition first — nothing is loaded — then the next
   * action, then what this axis is *for*. The collaboration claim is still the point, but it is
   * illegible if the reader cannot tell why the strip is blank.
   */
  if (!recording) {
    return (
      <div
        className="relative flex shrink-0 items-center justify-center overflow-hidden border-t border-line bg-base px-6"
        style={{ height: TIMELINE_HEIGHT_PX }}
      >
        {/*
          A ghost of the loaded axis, so this strip reads as a timeline that is waiting rather than one
          that failed to draw. Decorative, so it is hidden from assistive tech; the sentence below is the
          name of the state.
        */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute inset-x-0 top-0 h-[17px]">
            {GHOST_TICKS.map((at) => (
              <span
                key={at}
                className={`absolute top-0 w-px bg-line ${at % 25 === 0 ? 'h-1.5 bg-line-strong' : 'h-[3px]'}`}
                style={{ left: `${at}%` }}
              />
            ))}
          </div>
          <div className="absolute inset-x-3 bottom-2 h-1 rounded-full bg-line" />
        </div>
        <p className="relative flex max-w-xl flex-col items-center text-center text-body text-muted">
          <span className="flex items-center gap-1.5 font-medium text-ink">
            <Timer aria-hidden size={14} strokeWidth={1.75} className="text-muted" />
            Nothing on this timeline yet — no recording is loaded.
          </span>
          <span className="mt-0.5 text-meta text-faint">
            Load a sample from the list above. Your marks and the agent&apos;s findings will then share this
            axis, labelled by who found them.
          </span>
        </p>
      </div>
    )
  }

  const positionOf = (atMs: number) => percentOf(atMs, recording.durationMs)
  const anchorOf = (atMs: number) => anchorFor(atMs, recording.durationMs)

  const interval = tickIntervalFor(recording.durationMs)
  const ticks: number[] = []
  for (let at = 0; at <= recording.durationMs; at += interval) ticks.push(at)

  /** Every subdivision that is not already a labelled tick. Built from the same interval, so they cannot drift. */
  const minorInterval = interval / MINOR_TICKS_PER_LABEL
  const minorTicks: number[] = []
  for (let at = minorInterval; at <= recording.durationMs; at += minorInterval) {
    if (Math.abs(at % interval) > 1) minorTicks.push(at)
  }

  /** Recording-relative time under the cursor, from a clientX. Shared by the hover and the click. */
  const timeAt = (clientX: number, bounds: DOMRect): number => {
    const ratio = Math.min(Math.max((clientX - bounds.left) / bounds.width, 0), 1)
    return Math.round(ratio * recording.durationMs)
  }

  return (
    /*
     * `overflow-x-clip` is the frame guard, not styling. Every layer here is positioned by percentage and
     * several are centred on it — `EventTrack`'s hit target is 9px with `-translate-x-1/2`, so an event at
     * the end of the recording puts 4.5px of a button past the right edge, and the ticks and the playhead
     * each put 1px there. `<body>` is `overflow-hidden`, but with `<html>` visible that propagates to the
     * viewport and leaves the *body* visible, so those pixels do not vanish: they make the document 725px
     * wide at a 720px window. Nobody can scroll to them with a wheel, and tabbing onto the last event
     * marker scrolls the whole frame sideways to reveal it, which is the one thing this page must never do.
     * Measured with `race-condition` loaded at 720px. `clip` rather than `hidden` so the vertical axis can
     * stay `visible` — `hidden` on one axis computes the other to `auto` and hands the timeline a scrollbar.
     */
    <div
      className="relative shrink-0 select-none overflow-x-clip border-t border-line bg-base"
      style={{ height: TIMELINE_HEIGHT_PX }}
      onMouseMove={(event) => {
        const at = timeAt(event.clientX, event.currentTarget.getBoundingClientRect())
        // Guarded rather than throttled: a pointer emits these faster than the axis can say anything
        // new, and re-rendering every marker for a one-pixel move is how scrubbing starts to stutter.
        setHoverAtMs((previous) =>
          previous !== null && Math.abs(previous - at) < HOVER_RESOLUTION_MS ? previous : at,
        )
      }}
      onMouseLeave={() => setHoverAtMs(null)}
    >
      {/* First, so everything below can be clicked. See the note on layer order above. */}
      <button
        type="button"
        className="absolute inset-0 h-full w-full cursor-crosshair"
        aria-label="Seek"
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect()
          sessionActions().setCurrentTime(timeAt(event.clientX, bounds), 'human')
        }}
      />

      {/*
        The ruler. Both weights hang from the strip's own top border, which is the line they are ticks of —
        drawing a second rule under them would be a border on a border.
      */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[17px]">
        {minorTicks.map((at) => (
          <span
            key={`minor-${at}`}
            aria-hidden
            className="absolute top-0 h-[3px] w-px bg-line"
            style={{ left: positionOf(at) }}
          />
        ))}

        {ticks.map((at) => (
          <span key={at} className="absolute top-0" style={{ left: positionOf(at) }}>
            <span aria-hidden className="absolute top-0 h-1.5 w-px bg-line-strong" />
            {/*
              10px, the one size below the type floor, and deliberate: these are the axis's own units rather
              than something to read a sentence of, and every extra pixel here is a pixel of label crowding
              the next tick. `muted` instead of `faint` is what makes them legible after video compression.
            */}
            <span
              className={`absolute top-[7px] font-mono text-micro leading-none text-muted ${anchorOf(at)}`}
            >
              {formatSeconds(at)}
            </span>
          </span>
        ))}
      </div>

      <EventTrack />

      {markers.map((marker) => (
        <AnnotationMarker key={marker.id} marker={marker} left={positionOf(marker.timestamp)} />
      ))}

      <BisectTrace />

      {/* The reading, and a guide so the eye can carry it down to the event track and back. */}
      {hoverAtMs !== null ? (
        <div
          className="pointer-events-none absolute top-0 z-10 h-full"
          style={{ left: positionOf(hoverAtMs) }}
        >
          <span aria-hidden className="absolute top-0 h-full w-px bg-faint/70" />
          {/*
            Opaque and raised, because it lands on top of the tick labels it is a more precise version of.
            Transparent, it read as two numbers overlapping.
          */}
          <span
            className={`absolute top-0 rounded-sm border border-line-strong bg-raised px-1 font-mono text-label leading-tight text-ink shadow-raised ${anchorOf(hoverAtMs)}`}
          >
            {formatSeconds(hoverAtMs)}
          </span>
        </div>
      ) : null}

      {/*
        The playhead, above every band. `z-20` rather than DOM order alone: `AnnotationMarker` claims `z-10`
        for its hover label, and a marker sitting under the playhead would otherwise paint over it.
      */}
      <div
        className="pointer-events-none absolute top-0 z-20 h-full"
        style={{ left: positionOf(currentTime) }}
        aria-hidden
      >
        <span className="absolute top-0 h-full w-px bg-ink" />
        {/* The handle. A grab-looking tab in the ruler is what tells a viewer the line is the thing moving. */}
        <span className="absolute top-0 h-2 w-2.5 -translate-x-1/2 rounded-b-sm bg-ink" />
      </div>
    </div>
  )
}
