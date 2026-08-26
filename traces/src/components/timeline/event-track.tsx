'use client'

import { useMemo } from 'react'
import { buildEventDigest } from '@/lib/replay/event-digest'
import { sessionActions, useSessionStore } from '@/lib/store/session'
import type { DigestEvent } from '@/types/domain'

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
 */
export function EventTrack() {
  const recording = useSessionStore((s) => s.recording)

  const digest = useMemo<DigestEvent[]>(() => {
    if (!recording) return []
    try {
      return buildEventDigest(recording).events
    } catch {
      // buildEventDigest is Riko's Day 3. Until then the track is empty rather than the app being down.
      return []
    }
  }, [recording])

  if (!recording) return null

  /**
   * TODO(faiq), Day 3:
   *   - one tick per event, positioned by atMs / durationMs, coloured by severity via severityOf
   *   - rageClick reads as the loudest thing on the track; it is usually the most informative
   *   - tooltip on hover with kind, time and summary
   *   - click seeks. Clicking an event and landing on the wrong moment is a bug worth catching early
   */
  return (
    <div className="absolute bottom-0 h-4 w-full">
      {digest.map((event) => (
        <button
          key={`${event.kind}-${event.atMs}`}
          type="button"
          title={`${event.kind} — ${event.summary}`}
          onClick={() => sessionActions().setCurrentTime(event.atMs, 'human')}
          className="absolute bottom-0 h-2 w-px bg-zinc-600"
          style={{ left: `${(event.atMs / recording.durationMs) * 100}%` }}
        />
      ))}
    </div>
  )
}
