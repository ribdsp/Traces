'use client'

import { sessionActions } from '@/lib/store/session'
import { AuthorBadge } from '@/components/ui/author-badge'
import { formatSeconds } from '@/components/ui/format-time'
import type { Marker, Severity } from '@/types/domain'

interface AnnotationMarkerProps {
  marker: Marker
  /** Percentage string from Timeline. Positioning stays in the parent so one component owns the axis. */
  left: string
}

/**
 * One labelled moment on the timeline, with the controls that keep the human in charge of it.
 *
 * Two things this component is responsible for, and both are requirements rather than polish:
 *
 *   1. **Authorship is visible.** An agent's marker must never be mistaken for the human's. Colour
 *      alone doesn't carry that on a projector or for a colourblind viewer, so pair it with the badge.
 *   2. **Reject is per-marker, and undoable.** `rejected` markers are kept and drawn faded, not
 *      removed — the human's veto is itself a piece of the record, and restoring one has to work.
 *
 * So there are two independent channels, and which is which matters: **colour is severity, shape is
 * authorship.** An amber marker is a warning, not the agent's — the agent's are the ones with a diamond
 * head, at any severity. That is the opposite of AuthorBadge, where amber does mean the agent, and it is
 * exactly why the badge is rendered here as well: the one channel that cannot be misread is words.
 */

const TONES: Record<Severity, { fill: string; text: string }> = {
  info: { fill: 'bg-zinc-400', text: 'text-zinc-300' },
  warn: { fill: 'bg-amber-400', text: 'text-amber-200' },
  error: { fill: 'bg-rose-400', text: 'text-rose-200' },
}

export function AnnotationMarker({ marker, left }: AnnotationMarkerProps) {
  const isAgent = marker.author === 'agent'
  const tone = TONES[marker.severity]

  /**
   * Offered on the agent's markers only, matching `rejected` in the contract: it records a human's veto
   * over the agent, not an eraser for the human's own notes. If we ever want the second thing, it is
   * this condition and nothing else.
   */
  const canReject = isAgent

  const toggleRejected = () => {
    const actions = sessionActions()
    if (marker.rejected) actions.restoreMarker(marker.id)
    else actions.rejectMarker(marker.id)
  }

  return (
    /*
     * `z-10` is load-bearing: Timeline lays a full-area seek button over the whole axis, and without a
     * stacking order the marker is unclickable in a way that looks like a broken onClick.
     */
    <div
      className={`group absolute top-6 z-10 -translate-x-1/2 ${marker.rejected ? 'opacity-40' : ''}`}
      style={{ left }}
    >
      <button
        type="button"
        onClick={() => sessionActions().setCurrentTime(marker.timestamp, 'human')}
        aria-label={`Seek to ${marker.label}, ${marker.severity}, by ${isAgent ? 'the agent' : 'you'}, at ${formatSeconds(marker.timestamp)}${marker.rejected ? ', rejected' : ''}`}
        className="relative block h-4 w-3 cursor-pointer"
      >
        {/* The agent's head. Survives a compressed video, and a monochrome print of the same frame. */}
        {isAgent ? (
          <span
            aria-hidden
            className={`absolute left-1/2 top-0 h-[5px] w-[5px] -translate-x-1/2 rotate-45 ${tone.fill}`}
          />
        ) : null}

        <span
          aria-hidden
          className={`absolute bottom-0 left-1/2 h-3 w-[3px] -translate-x-1/2 ${tone.fill}`}
        />
      </button>

      {/*
        Hidden until hover, because ten permanently labelled moments is an unreadable axis.
        `group-focus-within` is not decoration: without it the reject button exists but cannot be
        reached from the keyboard, since focusing it is what would have revealed it.
      */}
      <div className="absolute left-2 top-0 z-20 hidden whitespace-nowrap group-hover:block group-focus-within:block">
        <span className="inline-flex items-center gap-1 border border-zinc-800 bg-zinc-900 px-1 py-0.5">
          <span className={`text-[10px] ${tone.text} ${marker.rejected ? 'line-through' : ''}`}>
            {marker.label}
          </span>
          <span className="font-mono text-[9px] text-zinc-500">{formatSeconds(marker.timestamp)}</span>
          <AuthorBadge author={marker.author} />

          {canReject ? (
            <button
              type="button"
              onClick={toggleRejected}
              aria-label={`${marker.rejected ? 'Restore' : 'Reject'} the agent's marker “${marker.label}”`}
              className="ml-0.5 border-l border-zinc-800 pl-1 text-[9px] uppercase tracking-wide text-zinc-500 hover:text-zinc-100"
            >
              {marker.rejected ? 'restore' : 'reject'}
            </button>
          ) : null}
        </span>
      </div>
    </div>
  )
}
