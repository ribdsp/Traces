'use client'

import { Pause, Play } from 'lucide-react'
import { useEffect } from 'react'
import {
  PLAYBACK_SPEEDS,
  STEP_COARSE_MS,
  STEP_MS,
  useLastSeekAuthor,
  usePlayback,
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
 *   - play/pause and 0.5× / 1× / 2×, held in local state by `usePlayback` — neither is the agent's
 *     business, and `SessionState` is frozen
 *   - a scrubber writing through `setCurrentTime(atMs, 'human')`, quantised to the arrow-key step so a
 *     focused slider and the global shortcut agree
 *   - a marker when the agent moved the playhead last, derived by `useLastSeekAuthor` rather than from a
 *     store field, and gone again as soon as the human moves it
 *   - space toggles, arrows step 100ms, shift-arrow 1s — ignored while focus is in something typable
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-3 py-2 text-xs text-muted">
      <button
        type="button"
        onClick={playback.toggle}
        disabled={disabled}
        title={playback.isPlaying ? 'Pause (space)' : 'Play (space)'}
        aria-label={playback.isPlaying ? 'Pause' : 'Play'}
        className="flex h-5 w-8 shrink-0 items-center justify-center border border-line text-ink hover:border-faint focus-visible:border-ink focus-visible:outline-none disabled:border-panel disabled:text-faint"
      >
        {/* The glyph is the whole control, so `aria-label` above is its only name — do not drop it. */}
        {playback.isPlaying ? (
          <Pause aria-hidden size={14} strokeWidth={1.5} />
        ) : (
          <Play aria-hidden size={14} strokeWidth={1.5} />
        )}
      </button>

      <span className="shrink-0 font-mono tabular-nums text-ink">
        {(currentTime / 1000).toFixed(3)}s
      </span>
      <span className="shrink-0 text-faint">/ {(durationMs / 1000).toFixed(3)}s</span>

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
          `accent-ink` rather than the `human` token: both parties move this playhead — the agent's seeks
          write to the same store — so the control itself must not claim an author. The `moved by AGENT`
          badge at the end of the row is what says who did, and it is the only thing here that may.
        */
        className="h-1 min-w-[6rem] flex-1 cursor-pointer accent-ink disabled:cursor-default disabled:accent-line"
      />

      <div className="flex shrink-0 gap-1">
        {PLAYBACK_SPEEDS.map((speed) => (
          <button
            key={speed}
            type="button"
            onClick={() => playback.setSpeed(speed)}
            disabled={disabled}
            aria-pressed={playback.speed === speed}
            className={`border px-1 py-0.5 font-mono text-[10px] focus-visible:border-ink focus-visible:outline-none disabled:border-panel disabled:text-faint ${
              playback.speed === speed
                ? 'border-faint text-ink'
                : 'border-line text-muted hover:text-ink'
            }`}
          >
            {speed}×
          </button>
        ))}
      </div>

      {/*
        A playhead that moves on its own is uncanny until it is attributed. This is deliberately quiet —
        it explains something already on screen rather than announcing it — and it disappears the moment
        the human moves the playhead themselves.
      */}
      <span className="w-28 shrink-0 text-right text-[10px] text-faint">
        {lastSeekAuthor === 'agent' ? (
          <>
            moved by
            <AuthorBadge author="agent" />
          </>
        ) : null}
      </span>
    </div>
  )
}
