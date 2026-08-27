'use client'

import { useMemo, useState } from 'react'
import { formatSeconds } from '@/components/ui/format-time'
import { buildEventDigest } from '@/lib/replay/event-digest'
import { sessionActions, severityOf, useSessionStore } from '@/lib/store/session'
import type { DigestEvent, DigestEventKind, Severity } from '@/types/domain'
import { anchorFor, percentOf } from './axis'

/**
 * The bottom band of the timeline: what actually happened, as ticks.
 *
 * Owner: Faiq, over Riko's event-digest.
 *
 * Same digest the agent sees through `list_events`, drawn instead of listed. That correspondence is
 * worth protecting: when the agent says "there's a failed request at 12.1s", the human should find a
 * tick at 12.1s and not have to take it on faith.
 *
 * The digest is derived from the recording, not stored, so it is computed here with `useMemo` keyed on
 * the recording id. Recomputing thousands of events on every playhead tick is the obvious way to make
 * scrubbing stutter.
 *
 * Implemented — faiq, Day 3:
 *   - one tick per event, positioned through the shared `percentOf` so a tick, a marker and a bisect probe
 *     at the same millisecond land on the same pixel
 *   - colour is severity, from the same `severityOf` the markers use, in the same three fills — so the two
 *     channels of the timeline agree. Kind is carried by height and weight instead of by hue.
 *   - `rageClick` is the tallest and heaviest thing on the track. It is usually the moment the user knew.
 *   - a hover card with kind, time and summary; the `title` attribute stays as the fallback
 *   - click seeks to the event's own `atMs`, the same number `list_events` reports
 */

/**
 * How loudly each kind reads, over the severity colour.
 *
 * `navigation` is `info` by severity but structural — it is where one page ends and the next begins — so it
 * gets height without the colour claiming anything. Clicks and inputs are the background texture: there are
 * hundreds of them and their job is to show the shape of the session, not to be read one by one.
 */
const WEIGHTS: Record<DigestEventKind, { height: string; width: string; opacity: string }> = {
  rageClick: { height: 'h-4', width: 'w-[3px]', opacity: 'opacity-100' },
  consoleError: { height: 'h-3', width: 'w-[2px]', opacity: 'opacity-95' },
  failedRequest: { height: 'h-3', width: 'w-[2px]', opacity: 'opacity-95' },
  consoleWarn: { height: 'h-2.5', width: 'w-px', opacity: 'opacity-85' },
  navigation: { height: 'h-2.5', width: 'w-px', opacity: 'opacity-70' },
  click: { height: 'h-1.5', width: 'w-px', opacity: 'opacity-50' },
  input: { height: 'h-1.5', width: 'w-px', opacity: 'opacity-50' },
}

/** Matches `AnnotationMarker`'s `TONES`. Two files, one meaning: colour is severity. */
const FILLS: Record<Severity, string> = {
  info: 'bg-zinc-400',
  warn: 'bg-amber-400',
  error: 'bg-rose-400',
}

/** The text half of the same tones, for the hover card's kind. */
const TEXTS: Record<Severity, string> = {
  info: 'text-zinc-300',
  warn: 'text-amber-200',
  error: 'text-rose-200',
}

/** Painted last is painted on top. An error next to five clicks has to survive the crowd. */
const PAINT_ORDER: Record<Severity, number> = { info: 0, warn: 1, error: 2 }

/** A 1px tick cannot be hit with a mouse. The visible mark stays 1px; the target around it does not. */
const HIT_WIDTH_PX = 9

export function EventTrack() {
  const recording = useSessionStore((s) => s.recording)
  const [hovered, setHovered] = useState<DigestEvent | null>(null)

  const digest = useMemo<DigestEvent[]>(() => {
    if (!recording) return []
    let events: DigestEvent[]
    try {
      events = buildEventDigest(recording).events
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
    <div className="pointer-events-none absolute bottom-0 h-4 w-full">
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
            className="pointer-events-auto absolute bottom-0 flex h-4 -translate-x-1/2 items-end justify-center"
            style={{ left: percentOf(event.atMs, recording.durationMs), width: HIT_WIDTH_PX }}
          >
            <span
              aria-hidden
              className={`${weight.height} ${weight.width} ${FILLS[severityOf(event.kind)]} ${
                isHovered ? 'opacity-100' : weight.opacity
              }`}
            />
          </button>
        )
      })}

      {/*
        One card for the whole band rather than a hidden one per tick: a busy recording puts hundreds of
        events here, and hundreds of pre-rendered tooltips is a slow timeline for a thing only ever seen one
        at a time. Above the ticks, so the card never covers the tick that summoned it.
      */}
      {hovered ? (
        <div
          className="pointer-events-none absolute bottom-5"
          style={{ left: percentOf(hovered.atMs, recording.durationMs) }}
        >
          <span
            className={`flex max-w-[24rem] items-baseline gap-1 border border-zinc-800 bg-zinc-900 px-1 py-0.5 ${anchorFor(hovered.atMs, recording.durationMs)}`}
          >
            <span className={`shrink-0 text-[10px] ${TEXTS[severityOf(hovered.kind)]}`}>
              {hovered.kind}
            </span>
            <span className="shrink-0 font-mono text-[9px] text-zinc-500">
              {formatSeconds(hovered.atMs)}
            </span>
            {/* Already one truncated line by contract, but a long selector in it must not widen the panel. */}
            <span className="truncate text-[10px] text-zinc-400">{hovered.summary}</span>
          </span>
        </div>
      ) : null}
    </div>
  )
}
