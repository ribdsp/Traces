'use client'

import { Check, ChevronDown, ChevronUp, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { SAMPLE_RECORDINGS, type SampleRecording } from '@/components/ui/sample-recordings'
import { formatSeconds } from '@/components/ui/format-time'
import { useSampleLoader } from '@/components/ui/use-sample-loader'
import { useSessionStore } from '@/lib/store/session'

/**
 * Loads a sample recording. The only control on the page that has to work before anything else does.
 *
 * All three states are real here, and none of them is theoretical:
 *
 *   loading — a recording is a few hundred KB of JSON. Say which one is coming.
 *   error   — `public/recordings/` may be empty, the JSON may be malformed, or the parse may reject it.
 *             All three are ordinary, and all three have to name the file and the reason. A picker that
 *             silently does nothing on click is the single worst thing this component could do, because
 *             the next person debugs the player instead of the missing file.
 *   loaded  — the trigger *is* the answer to "which one is this", so the header stops needing a legend.
 *
 * The fetch itself lives in `useSampleLoader`, shared with the empty state's one-click load.
 *
 * The labels are the file stems rather than prose, deliberately: they are the same ids the agent sees in
 * `read_session_meta`, so a human reading over the agent's shoulder does not have to translate.
 *
 * Why a dropdown rather than the three bare buttons this used to be: three toggles of equal weight said
 * nothing about which was open, cost the width of all three ids in a header that has to survive 720px,
 * and had nowhere to put the one thing a first-time viewer needs — *what the bug is*. A trigger plus a
 * panel puts the open recording's id in the header and each sample's blurb where it can be read.
 *
 * Written by hand against the listbox pattern rather than pulled from a UI library, because a headless
 * dropdown is roughly this much code once and a dependency forever. What the pattern requires, and what
 * is therefore not optional here: `aria-expanded` on the trigger, `role="listbox"` on the panel with
 * `role="option"` and `aria-selected` on each row, arrows to move, Enter to choose, and Escape to close
 * *and hand focus back to the trigger* — a dropdown that closes and drops the keyboard on the body is a
 * dropdown a keyboard user cannot get out of without a mouse.
 *
 * Duration and event count are shown for the open recording only. They are not in `SAMPLE_RECORDINGS`,
 * which is a static three-line manifest, and they cannot be without either fetching every sample at
 * mount to measure it or hardcoding numbers that go stale the next time a sample is re-recorded.
 */

/** `aria-activedescendant` needs a stable id per row, and the panel needs to scroll one into view. */
function optionId(id: string): string {
  return `recording-option-${id}`
}

export function RecordingPicker() {
  const recording = useSessionStore((s) => s.recording)
  const { load, loadingId, error } = useSampleLoader()

  const [open, setOpen] = useState(false)
  /** Which row the arrows are on. Separate from the selection: moving is not choosing. */
  const [activeIndex, setActiveIndex] = useState(0)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const openId = recording?.id ?? null
  const openIndex = SAMPLE_RECORDINGS.findIndex((sample) => sample.id === openId)

  /** Opening lands on the current recording, or the top of the list when nothing is loaded yet. */
  const show = () => {
    setActiveIndex(openIndex === -1 ? 0 : openIndex)
    setOpen(true)
  }

  const hide = (returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }

  const choose = (sample: SampleRecording) => {
    hide(true)
    void load(sample)
  }

  /* Focus the panel itself and drive it with `aria-activedescendant`, rather than moving DOM focus
     through the options — one focus target means Escape always has somewhere to return from. */
  useEffect(() => {
    if (open) listRef.current?.focus()
  }, [open])

  /** A click anywhere else closes it, and deliberately does *not* pull focus back to the trigger. */
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      const wrap = wrapRef.current
      if (wrap && event.target instanceof Node && !wrap.contains(event.target)) setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  /** Keep the arrow-selected row visible in a panel that scrolls at narrow heights. */
  useEffect(() => {
    if (!open) return
    const row = document.getElementById(optionId(SAMPLE_RECORDINGS[activeIndex]?.id ?? ''))
    row?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  const onListKeyDown = (event: React.KeyboardEvent) => {
    const last = SAMPLE_RECORDINGS.length - 1

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActiveIndex((index) => (index >= last ? 0 : index + 1))
        return
      case 'ArrowUp':
        event.preventDefault()
        setActiveIndex((index) => (index <= 0 ? last : index - 1))
        return
      case 'Home':
        event.preventDefault()
        setActiveIndex(0)
        return
      case 'End':
        event.preventDefault()
        setActiveIndex(last)
        return
      case 'Enter':
      case ' ': {
        event.preventDefault()
        // `noUncheckedIndexedAccess`: `activeIndex` is only ever set from this list's own bounds, but
        // the compiler cannot know that and a silent no-op is the right answer if it is ever wrong.
        const sample = SAMPLE_RECORDINGS[activeIndex]
        if (sample) choose(sample)
        return
      }
      case 'Escape':
        event.preventDefault()
        hide(true)
        return
      case 'Tab':
        // Let focus leave normally, but do not leave an orphaned panel open behind it.
        setOpen(false)
        return
      default:
        return
    }
  }

  const loading = loadingId !== null

  return (
    <div ref={wrapRef} className="relative flex min-w-0 shrink flex-col items-end">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={
          openId ? `Recording: ${openId}. Choose another.` : 'Choose a recording to load'
        }
        title="Which recorded session the player and the agent are both looking at."
        onClick={() => (open ? hide(false) : show())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            show()
          }
        }}
        className="flex min-w-0 max-w-[14rem] items-center gap-1.5 rounded-sm border border-line-strong bg-raised px-1.5 py-0.5 shadow-raised hover:border-faint"
      >
        <span className="text-label uppercase tracking-wide text-faint">rec</span>
        <span className="min-w-0 truncate font-mono text-meta text-ink">
          {loadingId ?? openId ?? 'none loaded'}
        </span>
        {loading ? (
          /*
            The one place a person waits on us rather than the other way round, so it gets the same dot
            vocabulary as the gate in `ask-human-visual-prompt.tsx` — `muted` instead of `warn`, because
            here the machine is the one working. The word stays: under `prefers-reduced-motion` the dot
            settles solid and "loading…" is what still says what is happening.
          */
          <span className="flex shrink-0 items-center gap-1.5 text-label text-muted">
            <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" />
            loading…
          </span>
        ) : /* Two glyphs rather than one rotated: reduced motion zeroes the transform and would leave
              the open state signalled by nothing. Same reasoning as `webmcp-badge.tsx`. */
        open ? (
          <ChevronUp aria-hidden size={13} strokeWidth={1.75} className="shrink-0 text-muted" />
        ) : (
          <ChevronDown aria-hidden size={13} strokeWidth={1.75} className="shrink-0 text-muted" />
        )}
      </button>

      {open ? (
        <ul
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          aria-label="Sample recordings"
          aria-activedescendant={optionId(SAMPLE_RECORDINGS[activeIndex]?.id ?? '')}
          onKeyDown={onListKeyDown}
          /* `raised` and a lighter border rather than a drop shadow — see the elevation note in
             CONTRIBUTING.md. `z-30` clears the docked WebMCP badge, which sits at 20. The panel keeps the
             global focus outline: it is the element that actually holds focus while open — options are
             driven by `aria-activedescendant`, not by moving focus — so suppressing it would leave a
             keyboard user with no indication of where they are, and the row highlight cannot stand in for
             one because `onMouseEnter` sets it too. */
          className="absolute right-0 top-[calc(100%+4px)] z-30 max-h-[60vh] w-[24rem] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-md border border-line-strong bg-raised p-1 shadow-raised"
        >
          {SAMPLE_RECORDINGS.map((sample, index) => {
            const isOpen = sample.id === openId
            const isActive = index === activeIndex

            return (
              <li
                key={sample.id}
                id={optionId(sample.id)}
                role="option"
                aria-selected={isOpen}
                onClick={() => choose(sample)}
                onMouseEnter={() => setActiveIndex(index)}
                className={`cursor-pointer rounded-sm px-2 py-1.5 ${
                  isActive ? 'bg-panel' : ''
                }`}
              >
                <p className="flex items-baseline gap-1.5">
                  {isOpen ? (
                    <Check aria-hidden size={14} strokeWidth={2} className="shrink-0 text-ok" />
                  ) : (
                    /* Holds the tick's column so the ids line up whether or not one is open. Its width and
                       the indent below are the icon's 14px plus the 6px `gap-1.5`. */
                    <span aria-hidden className="w-3.5 shrink-0" />
                  )}
                  <span
                    className={`min-w-0 truncate font-mono text-body ${isOpen ? 'text-ink' : 'text-muted'}`}
                  >
                    {sample.id}
                  </span>
                  {isOpen ? (
                    <span className="ml-auto shrink-0 text-label uppercase tracking-wide text-ok">
                      open
                    </span>
                  ) : null}
                </p>

                <p className="mt-0.5 pl-[1.25rem] text-meta leading-snug text-muted">
                  {sample.blurb}
                </p>

                {/* Only the loaded recording can say how long it is — see the note at the top. The
                    count comes from `meta.eventCount`, which is the number `read_session_meta` hands
                    the agent, so a human comparing the two is comparing the same figure. */}
                {isOpen && recording ? (
                  <p className="mt-1 flex items-center gap-1.5 pl-[1.25rem] font-mono text-label tabular-nums text-faint">
                    <span>{formatSeconds(recording.durationMs)}</span>
                    <span aria-hidden>·</span>
                    <span>{recording.meta.eventCount} events</span>
                    <span aria-hidden>·</span>
                    <span>
                      {recording.meta.viewport.width}×{recording.meta.viewport.height}
                    </span>
                  </p>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}

      {/*
        `max-w-full` rather than a fixed measure: at 720px a `36rem` paragraph is wider than the window,
        and the one component whose job is to explain a failure must not become one. Absolutely
        positioned, because the header is `shrink-0` and a wrapping error message that grew it would take
        the height out of the replay panel — the frame must not move because a fetch failed.
      */}
      {error ? (
        <p
          role="alert"
          className="absolute right-0 top-[calc(100%+4px)] z-20 flex w-[24rem] max-w-[calc(100vw-1.5rem)] items-start gap-1.5 rounded-md border border-error/50 bg-error/10 px-2 py-1.5 text-meta leading-snug text-error"
        >
          <TriangleAlert aria-hidden size={14} strokeWidth={1.75} className="mt-px shrink-0" />
          <span>
            <span className="font-mono">{error.id}</span> did not load: {error.message}.{' '}
            <span className="text-error/70">
              Samples live in <span className="font-mono">traces/public/recordings/</span> — record one
              against <span className="font-mono">bugbait</span> if it is not there yet.
            </span>
          </span>
        </p>
      ) : null}
    </div>
  )
}
