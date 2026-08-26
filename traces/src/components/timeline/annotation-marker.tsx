'use client'

import { sessionActions } from '@/lib/store/session'
import { AuthorBadge } from '@/components/ui/author-badge'
import type { Marker } from '@/types/domain'

interface AnnotationMarkerProps {
  marker: Marker
  /** Percentage string from Timeline. Positioning stays in the parent so one component owns the axis. */
  left: string
}

/**
 * One labelled moment on the timeline, with the controls that keep the human in charge of it.
 *
 * Owner: Faiq.
 *
 * Two things this component is responsible for, and both are requirements rather than polish:
 *
 *   1. **Authorship is visible.** An agent's marker must never be mistaken for the human's. Colour
 *      alone doesn't carry that on a projector or for a colourblind viewer, so pair it with the badge.
 *   2. **Reject is per-marker, and undoable.** `rejected` markers are kept and drawn faded, not
 *      removed — the human's veto is itself a piece of the record, and restoring one has to work.
 */
export function AnnotationMarker({ marker, left }: AnnotationMarkerProps) {
  const isAgent = marker.author === 'agent'

  /**
   * TODO(faiq), Day 4:
   *   - severity drives the colour, author drives the shape or border. Two channels, not one
   *   - hover reveals reject (or restore, when already rejected); don't show it permanently, the
   *     timeline gets unreadable at ten markers
   *   - clicking the marker seeks to it
   *   - rejected markers at ~40% opacity with a strikethrough label
   */
  return (
    <div className="group absolute top-8" style={{ left }}>
      <button
        type="button"
        onClick={() => sessionActions().setCurrentTime(marker.timestamp, 'human')}
        className={`h-3 w-1 ${isAgent ? 'bg-amber-400' : 'bg-sky-400'} ${marker.rejected ? 'opacity-40' : ''}`}
        aria-label={`${marker.label} at ${marker.timestamp}ms`}
      />

      <div className="pointer-events-none absolute left-2 top-0 hidden whitespace-nowrap group-hover:block">
        <span className="bg-zinc-900 px-1 text-[10px] text-zinc-300">{marker.label}</span>
        <AuthorBadge author={marker.author} />
      </div>
    </div>
  )
}
