'use client'

import { Check, ChevronDown, ChevronUp, Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  PLAYBACK_SPEEDS,
  STEP_COARSE_MS,
  STEP_MS,
  useLastSeekAuthor,
  usePlayback,
  type PlaybackSpeed,
} from '@/components/player/use-playhead'
import { AuthorBadge } from '@/components/ui/author-badge'
import { sessionActions, useSessionStore } from '@/lib/store/session'

/**
 * Play, pause, speed, and the current position.
 *
 * The one non-obvious requirement: the playhead position shown here is the *store's* `currentTime`,
 * not the Replayer's. Both a human dragging the scrubber and the agent calling `seek` write to the
 * store, so reading from the store is what makes an agent-driven seek visible in the UI at all. Read
 * from the Replayer instead and the agent's seeks appear to do nothing.
 *
 * Show the time in seconds with three decimals — `28.412s`. Agents talk about this recording in
 * milliseconds, and a human trying to check a claim needs to see the same number the agent said.
 *
 * Nothing here touches the Replayer either. Every control writes `setCurrentTime(_, 'human')` and the
 * frame follows through `usePlayheadSync`, which is what keeps one clock authoritative instead of two.
 *
 * What shipped, and why:
 *   - play/pause and a speed dropdown (0.5× / 1× / 2×), held in local state by `usePlayback` — neither
 *     is the agent's business, and `SessionState` is frozen
 *   - a scrubber writing through `setCurrentTime(atMs, 'human')`, quantised to the arrow-key step so a
 *     focused slider and the global shortcut agree
 *   - a marker when the agent moved the playhead last, derived by `useLastSeekAuthor` rather than from a
 *     store field, and gone again as soon as the human moves it
 *   - space toggles, arrows step 100ms, shift-arrow 1s — ignored while focus is in something typable
 *
 * Two notes on the appearance, since both look like decoration and are not:
 *
 * The scrubber is drawn as three stacked pieces — a track, a fill, and a native `input[type=range]` on
 * top with its own track suppressed — rather than left as a default slider. A default range input in a
 * dark UI is a 4px line with a 4px handle, which is unaimable with a mouse and invisible in a
 * compressed screen recording. The input keeps the full 20px row as its hit area while the visible
 * track stays 4px, and the fill behind the handle is the one cue that says *how far through this
 * recording we are* without reading the clock. The handle's own vendor pseudo-elements live in
 * `globals.css`, because `::-webkit-slider-thumb` cannot be reached from a utility class without a
 * dozen arbitrary variants that nobody will read twice.
 *
 * Speed is a compact dropdown rather than three segments. Three equal rectangles cost width the
 * scrubber needs at 720px, and a single trigger that reads "1×" already answers what speed this is
 * playing at. The menu opens upward so it sits on the replay, not on the timeline.
 */

/** So Day 6's shortcut can put focus on the scrubber without threading a ref through the layout. */
export const SCRUBBER_ID = 'traces-scrubber'

/**
 * Whether a keystroke belongs to whatever the human is typing in.
 *
 * The agent lane is a textarea a few hundred pixels away, and a global space-to-play that eats the space
 * bar mid-sentence is worse than no shortcut at all. Buttons and links are excluded for the opposite
 * reason: the browser already maps space and enter onto them, so handling it here as well would toggle
 * playback *and* re-press the focused button.
 */
function isOwnedByFocus(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true

  /*
   * The scrubber is the exception: it is a player control, not somewhere text goes. Day 6's `p` shortcut
   * puts focus here, and a focused scrubber that swallowed the space bar would trade play/pause for the
   * shortcut meant to make the player easier to reach. The arrows still move once per press — the
   * `preventDefault` below cancels the slider's own native step — and by the same amount as everywhere else.
   */
  if (target instanceof HTMLInputElement && target.type === 'range') return false

  return ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName)
}

export function PlayerControls() {
  const currentTime = useSessionStore((s) => s.currentTime)
  const recording = useSessionStore((s) => s.recording)
  const playback = usePlayback()
  const lastSeekAuthor = useLastSeekAuthor()

  const durationMs = recording?.durationMs ?? 0
  const disabled = recording === null

  /** The fill behind the handle. Clamped, because `currentTime` is not the scrubber's to bound. */
  const progress = durationMs === 0 ? 0 : Math.min(100, Math.max(0, (currentTime / durationMs) * 100))

  /**
   * Space and the arrows, bound at the window.
   *
   * These get used constantly while recording the demo, which is the whole reason they exist — reaching
   * for a 24px button between takes is how a demo ends up with dead air in it.
   */
  useEffect(() => {
    if (disabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isOwnedByFocus(event.target)) return

      if (event.key === ' ') {
        event.preventDefault()
        playback.toggle()
        return
      }

      const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
      if (direction === 0) return

      event.preventDefault()
      playback.step(direction * (event.shiftKey ? STEP_COARSE_MS : STEP_MS))
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [disabled, playback])

  return (
    /*
      `flex-wrap` with a floor under the scrubber, rather than one row that fits at 1280px and clips at
      720px. The left panel is only ~337px wide when the window is 720 — the agent column is a fixed
      380px — and eight controls in a row do not fit in that. Wrapping puts the speeds and the attribution
      on a second line and gives the scrubber the full width, which is the better narrow layout anyway;
      the alternative was hiding the duration, and a player that stops saying how long the recording is
      has lost something a viewer actually reads.
    */
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line bg-panel px-3 py-2 text-body text-muted">
      <button
        type="button"
        onClick={playback.toggle}
        disabled={disabled}
        title={playback.isPlaying ? 'Pause (space)' : 'Play (space)'}
        aria-label={playback.isPlaying ? 'Pause' : 'Play'}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-ink text-panel shadow-raised hover:opacity-90 disabled:border disabled:border-line disabled:bg-panel disabled:text-faint disabled:opacity-100"
      >
        {/* The glyph is the whole control, so `aria-label` above is its only name — do not drop it.
            Filled, and inverted against `ink`: a transport button is the one place in this UI that
            should read as a solid target, and a 14px hairline triangle does not survive being video. */}
        {playback.isPlaying ? (
          <Pause aria-hidden size={14} strokeWidth={1} className="fill-current" />
        ) : (
          <Play aria-hidden size={14} strokeWidth={1} className="ml-px fill-current" />
        )}
      </button>

      <span className="shrink-0 font-mono tabular-nums text-ink">
        {(currentTime / 1000).toFixed(3)}s
      </span>
      <span className="shrink-0 font-mono text-meta tabular-nums text-faint">
        / {(durationMs / 1000).toFixed(3)}s
      </span>

      {/*
        Three layers, one control. The track and fill are painted here; the handle is
        `.traces-scrubber` in globals.css. `min-w` keeps it from collapsing to nothing when the row wraps
        at 720px, where it is the widest thing on the second line.
      */}
      <div className="relative flex h-6 min-w-[8rem] flex-1 items-center">
        <div
          aria-hidden
          className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-line"
        />
        <div
          aria-hidden
          className={`absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full ${disabled ? 'bg-line-strong' : 'bg-ink'}`}
          style={{ width: `${progress}%` }}
        />
        {/*
          `step` matches the arrow-key step so a scrubber that has focus behaves like the global shortcut
          rather than like a 1ms slider nobody can aim.
        */}
        <input
          id={SCRUBBER_ID}
          type="range"
          min={0}
          max={durationMs === 0 ? 1 : durationMs}
          step={STEP_MS}
          value={currentTime}
          disabled={disabled}
          aria-label="Playhead"
          aria-valuetext={`${(currentTime / 1000).toFixed(3)} seconds`}
          onChange={(event) => {
            // A drag is the human taking over, so it stops the ticker rather than fighting it.
            playback.pause()
            sessionActions().setCurrentTime(Number(event.target.value), 'human')
          }}
          /*
            Neutral, not `human`: both parties move this playhead — the agent's seeks write to the same
            store — so the control itself must not claim an author. The `moved by AGENT` badge at the end
            of the row is what says who did, and it is the only thing here that may.
          */
          className="traces-scrubber relative h-6 w-full cursor-pointer disabled:cursor-default"
        />
      </div>

      <SpeedMenu
        speed={playback.speed}
        disabled={disabled}
        onChange={playback.setSpeed}
      />

      {/*
        A playhead that moves on its own is uncanny until it is attributed. Always on, so the slot does
        not sit empty and then jump when the agent first seeks. `whitespace-nowrap` because this row
        wraps at 720px and the words must not wrap inside the chip.
      */}
      <SeekAttribution disabled={disabled} author={lastSeekAuthor} />
    </div>
  )
}

function SeekAttribution({
  disabled,
  author,
}: {
  disabled: boolean
  author: 'human' | 'agent' | null
}) {
  return (
    <span className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border border-line bg-raised px-1.5 py-0.5 text-label text-faint shadow-raised">
      {disabled ? (
        'No Recording'
      ) : author === null ? (
        'Ready'
      ) : (
        <>
          Moved by
          <AuthorBadge author={author} className="!ml-0" />
        </>
      )}
    </span>
  )
}

function SpeedMenu({
  speed,
  disabled,
  onChange,
}: {
  speed: PlaybackSpeed
  disabled: boolean
  onChange: (speed: PlaybackSpeed) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      const wrap = wrapRef.current
      if (wrap && event.target instanceof Node && !wrap.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Playback speed ${speed}×`}
        title="Playback speed"
        onClick={() => setOpen((was) => !was)}
        className="flex h-7 items-center gap-1 rounded-sm border border-line-strong bg-raised px-1.5 font-mono text-label tabular-nums text-ink shadow-raised hover:border-faint disabled:text-faint"
      >
        {speed}×
        {open ? (
          <ChevronDown aria-hidden size={12} strokeWidth={1.75} className="text-muted" />
        ) : (
          <ChevronUp aria-hidden size={12} strokeWidth={1.75} className="text-muted" />
        )}
      </button>

      {open ? (
        <ul
          role="listbox"
          aria-label="Playback speed"
          className="absolute bottom-[calc(100%+4px)] right-0 z-20 min-w-full overflow-hidden rounded-md border border-line-strong bg-raised p-0.5 shadow-raised"
        >
          {PLAYBACK_SPEEDS.map((option) => {
            const active = option === speed
            return (
              <li key={option} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(option)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 font-mono text-label tabular-nums ${
                    active ? 'bg-panel text-ink' : 'text-muted hover:bg-panel hover:text-ink'
                  }`}
                >
                  {active ? (
                    <Check aria-hidden size={12} strokeWidth={2} className="text-ok" />
                  ) : (
                    <span aria-hidden className="w-3 shrink-0" />
                  )}
                  {option}×
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
