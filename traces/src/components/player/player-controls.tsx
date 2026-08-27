'use client'

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
 * Owner: Faiq.
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
 * Implemented — faiq, Day 2:
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
    <div className="flex items-center gap-3 border-t border-zinc-800 px-3 py-2 text-xs text-zinc-400">
      <button
        type="button"
        onClick={playback.toggle}
        disabled={disabled}
        title={playback.isPlaying ? 'Pause (space)' : 'Play (space)'}
        aria-label={playback.isPlaying ? 'Pause' : 'Play'}
        className="w-12 shrink-0 border border-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-300 hover:border-zinc-600 hover:text-zinc-100 disabled:border-zinc-900 disabled:text-zinc-700"
      >
        {playback.isPlaying ? 'pause' : 'play'}
      </button>

      <span className="shrink-0 font-mono tabular-nums">{(currentTime / 1000).toFixed(3)}s</span>
      <span className="shrink-0 text-zinc-600">/ {(durationMs / 1000).toFixed(3)}s</span>

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
        className="h-1 min-w-0 flex-1 cursor-pointer accent-sky-400 disabled:cursor-default disabled:accent-zinc-700"
      />

      <div className="flex shrink-0 gap-1">
        {PLAYBACK_SPEEDS.map((speed) => (
          <button
            key={speed}
            type="button"
            onClick={() => playback.setSpeed(speed)}
            disabled={disabled}
            aria-pressed={playback.speed === speed}
            className={`border px-1 py-0.5 font-mono text-[10px] disabled:border-zinc-900 disabled:text-zinc-700 ${
              playback.speed === speed
                ? 'border-zinc-600 text-zinc-100'
                : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'
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
      <span className="w-28 shrink-0 text-right text-[10px] text-zinc-600">
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
