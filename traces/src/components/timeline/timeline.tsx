'use client'

import { sessionActions, useSessionStore } from '@/lib/store/session'
import { AnnotationMarker } from './annotation-marker'
import { BisectTrace } from './bisect-trace'
import { EventTrack } from './event-track'

/**
 * The shared timeline: one horizontal axis that both the human and the agent write to.
 *
 * Owner: Faiq.
 *
 * This is the component that carries the collaboration claim. Everything the agent finds lands here,
 * on the same axis as everything the human noticed, colour-coded by author. Someone watching the demo
 * should be able to see, without narration, that two parties were working on one artefact.
 *
 * All positioning is a percentage of `durationMs`, never pixels. The panel is resizable and the demo
 * gets recorded at a different width than anyone develops at.
 */
export function Timeline() {
  const recording = useSessionStore((s) => s.recording)
  const markers = useSessionStore((s) => s.markers)
  const currentTime = useSessionStore((s) => s.currentTime)

  if (!recording) {
    return <div className="h-24 border-t border-zinc-800" />
  }

  const positionOf = (atMs: number) => `${(atMs / recording.durationMs) * 100}%`

  /**
   * TODO(faiq), Day 2 for the axis, Day 4 for the layers:
   *   - stack the layers: event track at the bottom, markers above it, bisect trace on top, playhead
   *     over everything
   *   - click anywhere on the axis to seek via setCurrentTime(atMs, 'human')
   *   - tick labels every 5s, in seconds with one decimal
   *   - hover shows the time under the cursor. Checking an agent's claimed timestamp against the
   *     timeline is the single most common thing anyone does with this app
   */
  return (
    <div className="relative h-24 select-none border-t border-zinc-800 bg-zinc-950">
      <EventTrack />
      <BisectTrace />

      {markers.map((marker) => (
        <AnnotationMarker key={marker.id} marker={marker} left={positionOf(marker.timestamp)} />
      ))}

      <div
        className="absolute top-0 h-full w-px bg-zinc-100"
        style={{ left: positionOf(currentTime) }}
        aria-hidden
      />

      <button
        type="button"
        className="absolute inset-0 h-full w-full cursor-crosshair"
        aria-label="Seek"
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect()
          const ratio = (event.clientX - bounds.left) / bounds.width
          sessionActions().setCurrentTime(Math.round(ratio * recording.durationMs), 'human')
        }}
      />
    </div>
  )
}
