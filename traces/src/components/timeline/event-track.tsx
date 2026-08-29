'use client'

import { useMemo, useState } from 'react'
import { formatSeconds } from '@/components/ui/format-time'
import { buildEventDigest } from '@/lib/replay/event-digest'
import { sessionActions, severityOf, useSessionStore } from '@/lib/store/session'
import type { DigestEvent, DigestEventKind, Severity } from '@/types/domain'
import { percentOf } from './axis'

/**
 * The bottom band of the timeline: what actually happened, as lozenges.
 *
 * Sits over lib/replay/event-digest.
 *
 * Same digest the agent sees through `list_events`, drawn instead of listed. That correspondence is
 * worth protecting: when the agent says "there's a failed request at 12.1s", the human should find a
 * tick at 12.1s and not have to take it on faith.
 *
 * The digest is derived from the recording, not stored, so it is computed here with `useMemo` keyed on
 * the recording id. Recomputing thousands of events on every playhead tick is the obvious way to make
 * scrubbing stutter.
 *
 * What shipped, and why:
 *   - one lozenge per event, positioned through the shared `percentOf` so a mark, a marker and a bisect probe
 *     at the same millisecond land on the same pixel
 *   - colour is severity, from the same `severityOf` the tools use, in the three severity fills. Kind is
 *     carried by height and weight instead of by hue, so the band has exactly one colour vocabulary.
 *   - lozenges rather than hairlines. A 1px mark at `opacity-50` is gone after video compression, and this
 *     band is the evidence a viewer checks a claimed timestamp against — if it does not survive the encode
 *     it is not evidence. Everything here got wider, rounder and more opaque; the *ratios* between kinds
 *     are unchanged, so the reading is the same one, just visible.
 *   - `rageClick` is the tallest and heaviest thing on the track. It is usually the moment the user knew.
 *   - a ground rule along the bottom, so the marks stand on a track instead of floating in the strip
 *   - a hover card with kind, time and summary; the `title` attribute stays as the fallback
 *   - click seeks to the event's own `atMs`, the same number `list_events` reports
 */

/**
 * How loudly each kind reads, over the severity colour.
 *
 * `navigation` is `info` by severity but structural — it is where one page ends and the next begins — so it
 * gets height without the colour claiming anything. Clicks and inputs are the background texture: there are
 * hundreds of them and their job is to show the shape of the session, not to be read one by one.
 *
 * `radius` is what makes these lozenges rather than bars, and it is per-kind because a 3px radius on a 2px
 * mark is a dot. Each one is half its own width, which is the only value that reads as a rounded end.
 */
const WEIGHTS: Record<
  DigestEventKind,
  { height: string; width: string; radius: string; opacity: string }
> = {
  rageClick: { height: 'h-5', width: 'w-1', radius: 'rounded-sm', opacity: 'opacity-100' },
  consoleError: { height: 'h-4', width: 'w-[3px]', radius: 'rounded-[1.5px]', opacity: 'opacity-100' },
  failedRequest: { height: 'h-4', width: 'w-[3px]', radius: 'rounded-[1.5px]', opacity: 'opacity-100' },
  consoleWarn: { height: 'h-3', width: 'w-[3px]', radius: 'rounded-[1.5px]', opacity: 'opacity-90' },
  navigation: { height: 'h-3', width: 'w-[2px]', radius: 'rounded-[1px]', opacity: 'opacity-75' },
  click: { height: 'h-2', width: 'w-[2px]', radius: 'rounded-[1px]', opacity: 'opacity-60' },
  input: { height: 'h-2', width: 'w-[2px]', radius: 'rounded-[1px]', opacity: 'opacity-60' },
}

/**
 * Severity, as three fills.
 *
 * This band keeps severity colour while `AnnotationMarker` switched to authorship colour, and the split is
 * deliberate: these marks are *the recording*, and their agreement with `severityOf` is what lets a human
 * check the agent's claim that there was an error at 12.1s. Markers are *what someone said about* the
 * recording, so who said it is the useful thing to colour. One band per question.
 */
const FILLS: Record<Severity, string> = {
  info: 'bg-muted',
  warn: 'bg-warn',
  error: 'bg-error',
}

/** The text half of the same tones, for the hover card's kind. */
const TEXTS: Record<Severity, string> = {
  info: 'text-ink',
  warn: 'text-warn',
  error: 'text-error',
}

/** Painted last is painted on top. An error next to five clicks has to survive the crowd. */
const PAINT_ORDER: Record<Severity, number> = { info: 0, warn: 1, error: 2 }

/** A 3px lozenge cannot be hit with a mouse. The visible mark keeps its weight; the target around it does not. */
const HIT_WIDTH_PX = 9

/**
 * Which way the hover card grows.
 *
 * Not `anchorFor`: that centres a label on its anchor, which is right for a five-character timestamp and
 * wrong for a card up to 20rem wide. Centred on an event at 10% of a 720px strip, half the card is off the
 * left edge and the strip's `overflow-x-clip` eats it. Growing away from the midpoint keeps a card narrower
 * than half the strip inside it at any position, and the cost is only that the card is corner-anchored to
 * its lozenge rather than centred over it.
 */
function cardAnchorFor(atMs: number, durationMs: number): string {
  return durationMs > 0 && atMs / durationMs > 0.5 ? '-translate-x-full' : 'translate-x-0'
}

export function EventTrack() {
  const recording = useSessionStore((s) => s.recording)
  const [hovered, setHovered] = useState<DigestEvent | null>(null)

  const digest = useMemo<DigestEvent[]>(() => {
    if (!recording) return []
    let events: DigestEvent[]
    try {
      // Unbounded on purpose. `buildEventDigest`'s default `DIGEST_LIMIT` keeps the *earliest* 40
      // events, which is one page of `list_events` and half a timeline. Measured on the three committed
      // recordings: the default stops the band at 23.2s of a ~44s session every time, silently dropping
      // 27-35 marks including a console error in two of them. A band that ends early does not look
      // truncated, it looks like a session where nothing happened after the halfway point — and the
      // error tick it drops is the one mark someone scanning this band is looking for.
      events = buildEventDigest(recording, { limit: Number.MAX_SAFE_INTEGER }).events
    } catch {
      // A malformed recording must not take the app down with it — the player, the axis and the tools all
      // still work without this band. (The digest itself ships and is tested; this guard is for the input.)
      return []
    }
    return [...events].sort((a, b) => PAINT_ORDER[severityOf(a.kind)] - PAINT_ORDER[severityOf(b.kind)])
  }, [recording])

  if (!recording) return null

  return (
    /*
     * `pointer-events-none` on the band, restored on the ticks. Timeline lays a full-area seek button under
     * this layer, and a transparent full-width div over it would eat every click in the bottom quarter of
     * the axis — a bug that presents as click-to-seek working everywhere except near the events.
     */
    <div className="pointer-events-none absolute bottom-0 h-6 w-full">
      {/*
        The track the marks stand on. Drawn before them so they paint over it — a mark that stops a pixel
        short of its own baseline reads as misaligned, and at these widths a pixel is a third of a mark.
      */}
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-line" />

      {digest.map((event, index) => {
        const weight = WEIGHTS[event.kind]
        const isHovered = hovered === event

        return (
          <button
            // Two events of the same kind can share a millisecond, so the index is part of the identity.
            key={`${event.kind}-${event.atMs}-${index}`}
            type="button"
            title={`${event.kind} — ${formatSeconds(event.atMs)} — ${event.summary}`}
            aria-label={`Seek to ${event.kind} at ${formatSeconds(event.atMs)}: ${event.summary}`}
            onClick={() => sessionActions().setCurrentTime(event.atMs, 'human')}
            onMouseEnter={() => setHovered(event)}
            onMouseLeave={() => setHovered((current) => (current === event ? null : current))}
            onFocus={() => setHovered(event)}
            onBlur={() => setHovered((current) => (current === event ? null : current))}
            className="pointer-events-auto absolute bottom-0 flex h-6 -translate-x-1/2 items-end justify-center"
            style={{ left: percentOf(event.atMs, recording.durationMs), width: HIT_WIDTH_PX }}
          >
            <span
              aria-hidden
              className={`${weight.height} ${weight.width} ${weight.radius} ${FILLS[severityOf(event.kind)]} ${
                isHovered ? 'opacity-100' : weight.opacity
              }`}
            />
          </button>
        )
      })}

      {/*
        One card for the whole band rather than a hidden one per lozenge: a busy recording puts hundreds of
        events here, and hundreds of pre-rendered tooltips is a slow timeline for a thing only ever seen one
        at a time. Above the marks, so the card never covers the one that summoned it.
      */}
      {hovered ? (
        <div
          className="pointer-events-none absolute bottom-7"
          style={{ left: percentOf(hovered.atMs, recording.durationMs) }}
        >
          <span
            className={`flex max-w-[20rem] items-baseline gap-1 rounded-sm border border-line-strong bg-raised px-1 py-0.5 shadow-raised ${cardAnchorFor(hovered.atMs, recording.durationMs)}`}
          >
            <span
              className={`shrink-0 text-label font-medium ${TEXTS[severityOf(hovered.kind)]}`}
            >
              {hovered.kind}
            </span>
            <span className="shrink-0 font-mono text-label tabular-nums text-muted">
              {formatSeconds(hovered.atMs)}
            </span>
            {/* Already one truncated line by contract, but a long selector in it must not widen the panel. */}
            <span className="truncate text-label text-muted">{hovered.summary}</span>
          </span>
        </div>
      ) : null}
    </div>
  )
}
