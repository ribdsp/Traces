'use client'

import { sessionActions } from '@/lib/store/session'
import { AuthorBadge } from '@/components/ui/author-badge'
import { formatSeconds } from '@/components/ui/format-time'
import type { Author, Marker, Severity } from '@/types/domain'
import { MARKER_TOP_PX, TIMELINE_HEIGHT_PX } from './axis'

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
 * **Colour here is authorship, and so is shape.** This band used to spend its hue on severity, on the
 * argument that authorship was carried by the diamond head alone. That was the wrong trade for the surface
 * that has to make the collaboration claim: this axis exists to show two parties writing on one artefact,
 * and a viewer three metres from a compressed recording reads colour long before they read a 5px head. So
 * `human` and `agent` own the fill, and the head stays — belt and braces, because a monochrome frame or a
 * colourblind viewer then still has the shape. Severity did not disappear: it is the pin's height, the tint
 * of the hover label, a word in the `aria-label`, and — where it matters most, because that band is the
 * recording rather than a claim about it — the whole colour vocabulary of `EventTrack` below.
 *
 * The badge is still rendered next to the label, for the same reason as ever: the one channel that cannot
 * be misread is words.
 */

/** Authorship, as a fill and a guide. The same two colours as the badge and the activity feed's rails. */
const AUTHORS: Record<Author, { fill: string; guide: string }> = {
  human: { fill: 'bg-human', guide: 'bg-human/50' },
  agent: { fill: 'bg-agent', guide: 'bg-agent/50' },
}

/**
 * Severity, as pin height.
 *
 * A free channel — the pin has to be *some* height — and it survives both a monochrome frame and a reader
 * who does not know the palette, because taller reading as louder needs no key. The ceiling is set by the
 * band: 14px of stem plus the agent's 5px head is 19px inside a 20px row, and a pixel more would put the
 * tallest agent marker into the ruler's labels.
 */
const STEM_HEIGHTS: Record<Severity, string> = {
  info: 'h-2.5',
  warn: 'h-3',
  error: 'h-3.5',
}

/** The text half of the severity tones, for the hover label. */
const TONES: Record<Severity, string> = {
  info: 'text-ink',
  warn: 'text-warn',
  error: 'text-error',
}

/**
 * The pin's hit target, in pixels.
 *
 * 24 wide, 20 tall, and the asymmetry is the band's rather than a preference. Horizontal is the axis, so it
 * is the direction a pointer actually misses in — 24px there is the whole of the usual target guidance
 * applied where it pays. Vertical is capped by geometry: this band runs from `MARKER_TOP_PX` to the top of
 * the bisect funnel at 40px, and a taller button would sit over the funnel and swallow clicks meant for its
 * probes. Given a choice between a marker that is hard to hit and a probe that cannot be clicked at all,
 * this is the one that degrades gracefully.
 */
const HIT_WIDTH_PX = 24
const HIT_HEIGHT_PX = 20

export function AnnotationMarker({ marker, left }: AnnotationMarkerProps) {
  const isAgent = marker.author === 'agent'
  const author = AUTHORS[marker.author]

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
      className={`group absolute z-10 -translate-x-1/2 ${marker.rejected ? 'opacity-40' : ''}`}
      style={{ left, top: MARKER_TOP_PX }}
    >
      {/*
        The guide, on hover or focus. A pin says "something is here"; this says what is *underneath* it —
        which bisect probe, which event lozenge, where the playhead would land. Full strip height, from the
        two shared constants, because a guide that stops short of the event track cannot answer that.
      */}
      <span
        aria-hidden
        className={`pointer-events-none absolute left-1/2 hidden w-px -translate-x-1/2 group-hover:block group-focus-within:block ${author.guide}`}
        style={{ top: -MARKER_TOP_PX, height: TIMELINE_HEIGHT_PX }}
      />

      <button
        type="button"
        onClick={() => sessionActions().setCurrentTime(marker.timestamp, 'human')}
        aria-label={`Seek to ${marker.label}, ${marker.severity}, by ${isAgent ? 'the agent' : 'you'}, at ${formatSeconds(marker.timestamp)}${marker.rejected ? ', rejected' : ''}`}
        className="relative flex cursor-pointer items-end justify-center"
        style={{ width: HIT_WIDTH_PX, height: HIT_HEIGHT_PX }}
      >
        <span aria-hidden className="flex flex-col items-center">
          {/* The agent's head. Survives a compressed video, and a monochrome print of the same frame. */}
          {isAgent ? <span className={`h-[5px] w-[5px] rotate-45 ${author.fill}`} /> : null}
          <span className={`w-[3px] rounded-t-sm ${STEM_HEIGHTS[marker.severity]} ${author.fill}`} />
        </span>
      </button>

      {/*
        Hidden until hover, because ten permanently labelled moments is an unreadable axis.
        `group-focus-within` is not decoration: without it the reject button exists but cannot be
        reached from the keyboard, since focusing it is what would have revealed it.
      */}
      <div className="absolute left-3 top-0 z-20 hidden whitespace-nowrap group-hover:block group-focus-within:block">
        <span className="inline-flex items-center gap-1 rounded-sm border border-line-strong bg-raised px-1 py-0.5 shadow-raised">
          <span
            className={`text-label ${TONES[marker.severity]} ${marker.rejected ? 'line-through' : ''}`}
          >
            {marker.label}
          </span>
          <span className="font-mono text-label tabular-nums text-muted">
            {formatSeconds(marker.timestamp)}
          </span>
          <AuthorBadge author={marker.author} />

          {canReject ? (
            <button
              type="button"
              onClick={toggleRejected}
              aria-label={`${marker.rejected ? 'Restore' : 'Reject'} the agent's marker “${marker.label}”`}
              className="ml-0.5 rounded-sm border-l border-line pl-1 text-label uppercase tracking-wide text-muted hover:text-ink"
            >
              {marker.rejected ? 'restore' : 'reject'}
            </button>
          ) : null}
        </span>
      </div>
    </div>
  )
}
