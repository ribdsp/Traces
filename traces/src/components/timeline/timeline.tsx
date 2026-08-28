'use client'

import { useState } from 'react'
import { formatSeconds } from '@/components/ui/format-time'
import { sessionActions, useSessionStore } from '@/lib/store/session'
import { AnnotationMarker } from './annotation-marker'
import { anchorFor, percentOf } from './axis'
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
 *   - tick labels through `formatSeconds`, spaced so the axis never crowds
 *   - a hover guide with the time under the cursor, because checking an agent's claimed timestamp
 *     against the axis is the single most common act in this app and it should not cost a click
 *
 * The vertical budget is 96px and every band has a fixed home, so two layers never land on each other:
 * ruler at the top, markers at 24px (`AnnotationMarker` owns that offset), the bisect funnel between
 * them and the event track, and the event track along the bottom.
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

/** Below this, a pointer move is not a new reading — it is the same instant, one pixel over. */
const HOVER_RESOLUTION_MS = 50

export function Timeline() {
  const recording = useSessionStore((s) => s.recording)
  const markers = useSessionStore((s) => s.markers)
  const currentTime = useSessionStore((s) => s.currentTime)
  const [hoverAtMs, setHoverAtMs] = useState<number | null>(null)

  /**
   * The empty state is a sentence rather than a blank bar. A 96px grey strip under the player reads as
   * a timeline that failed to draw, and the one thing worth saying here is what this axis is *for* —
   * it is the collaboration claim, and it is legible before any data arrives.
   */
  if (!recording) {
    return (
      <div className="flex h-24 shrink-0 items-center justify-center border-t border-line px-6">
        <p className="text-center text-[11px] text-muted">
          The shared timeline appears here once a recording is loaded.
          <span className="mt-0.5 block text-faint">
            Everything you mark and everything the agent finds lands on this one axis, labelled by who
            found it.
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
      className="relative h-24 shrink-0 select-none overflow-x-clip border-t border-line bg-base"
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

      <div className="pointer-events-none absolute inset-x-0 top-0 h-3">
        {ticks.map((at) => (
          <span key={at} className="absolute top-0" style={{ left: positionOf(at) }}>
            <span aria-hidden className="absolute top-0 h-1.5 w-px bg-line" />
            <span
              className={`absolute top-1.5 font-mono text-[9px] leading-none text-faint ${anchorOf(at)}`}
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
          className="pointer-events-none absolute top-0 h-full"
          style={{ left: positionOf(hoverAtMs) }}
        >
          <span aria-hidden className="absolute top-0 h-full w-px bg-faint/70" />
          <span
            className={`absolute top-0 bg-panel px-1 font-mono text-[10px] leading-tight text-ink ${anchorOf(hoverAtMs)}`}
          >
            {formatSeconds(hoverAtMs)}
          </span>
        </div>
      ) : null}

      <div
        className="pointer-events-none absolute top-0 h-full w-px bg-ink"
        style={{ left: positionOf(currentTime) }}
        aria-hidden
      />
    </div>
  )
}
