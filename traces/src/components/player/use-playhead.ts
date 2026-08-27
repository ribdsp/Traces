'use client'

import { useEffect, useState } from 'react'
import { getActiveEngine } from '@/lib/replay/replay-engine'
import { sessionActions, useSessionStore } from '@/lib/store/session'
import type { Author } from '@/types/domain'

/**
 * The three pieces of playhead behaviour the store deliberately does not own.
 *
 * Owner: Faiq, over Riko's lib/replay and Vicko's lib/store.
 *
 * `setCurrentTime` writes the store and stops there — see the comment on it in lib/store/session.ts,
 * which is about *feed noise* rather than about pixels. Nothing in the store moves the replay. The
 * tools get away with that because each one seeks the engine itself (`seek.ts` writes the store and
 * calls `gotoTime`), but a human clicking the timeline goes through the store alone, so before this
 * hook existed the playhead line moved and the frame behind it did not.
 *
 * `usePlayheadSync` is the missing half. It is a subscription rather than a `useEffect` on
 * `currentTime` because a scrub emits changes faster than React commits, and every dropped intermediate
 * value is a frame the human asked for and never saw.
 *
 * `usePlayback` is play/pause. `ReplayEngine` exposes no `play`, on purpose — the store is the single
 * source of the playhead, and handing the Replayer its own clock would give it a second one that drifts.
 * So playback is a ticker that steps the store, exactly as `seek.ts` does for the agent's bounded
 * `play`, and the frame follows through `usePlayheadSync` like any other seek.
 *
 * `useLastSeekAuthor` answers "who moved this?" without a store field to read it from — `SessionState`
 * is frozen, and this is a fact about the last transition rather than a piece of session state anyway.
 */

/**
 * How far the engine may already be from the store before a seek is considered worth doing.
 *
 * This is what keeps the hook from fighting the tools. `seek.ts` and `ask_human_visual` both write the
 * store *and* seek the engine, and our subscription fires on the first of those, synchronously, before
 * their own `await engine.gotoTime(...)` has run. Without a tolerance the engine would be asked for the
 * same instant twice on every agent seek. A probe costs 0.028 ms (measured — see `gotoTime`) so the
 * duplicate is cheap rather than harmful, but the tolerance also covers the case that matters more: a
 * read tool that moved the engine without touching the store. Those probes are invisible here by
 * construction, because reads never call `setCurrentTime`, and this hook must keep it that way.
 *
 * 40 ms is under half a tick of playback, so it never swallows a step, and well over the ~1 ms of
 * rounding between what we ask for and what `getCurrentTime()` reports.
 */
const SEEK_TOLERANCE_MS = 40

/**
 * Drive the replay engine from the store's playhead. Mount exactly once, from `ReplayStage`.
 *
 * Latest-wins rather than queued: during a drag the store emits dozens of positions a second and only
 * the newest is worth replaying. Queueing them would replay the whole gesture in slow motion after the
 * hand had stopped, which reads as a player lagging seconds behind the cursor.
 */
export function usePlayheadSync(): void {
  useEffect(() => {
    let cancelled = false
    /** The position the engine should end up at. Overwritten while a seek is in flight, never queued. */
    let desired: number | null = null
    let pumping = false

    const pump = async (): Promise<void> => {
      if (pumping) return
      pumping = true
      try {
        while (!cancelled && desired !== null) {
          const target = desired
          desired = null

          const engine = getActiveEngine()
          // No stage yet. The timeline is usable before the player mounts, and this is not an error.
          if (engine === null) break

          if (Math.abs(engine.currentTime() - target) <= SEEK_TOLERANCE_MS) continue

          try {
            await engine.gotoTime(target)
          } catch {
            /*
             * A seek can throw while the Replayer is still building its first snapshot. `ReplayStage`
             * already surfaces a construction failure on screen, and the next seek will succeed, so a
             * second error surface here would report a transient as a fault.
             */
          }
        }
      } finally {
        pumping = false
      }
    }

    const unsubscribe = useSessionStore.subscribe((state, previous) => {
      if (state.currentTime === previous.currentTime) return
      desired = state.currentTime
      void pump()
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

export type PlaybackSpeed = 0.5 | 1 | 2

/** Offered in the controls in this order. Nothing faster: past 2× the bug goes by unseen. */
export const PLAYBACK_SPEEDS: readonly PlaybackSpeed[] = [0.5, 1, 2]

/** How often the playhead advances. 10fps, the same cadence as `PLAY_TICK_MS` in the `seek` tool. */
const TICK_MS = 100

/** One arrow press. Small enough to land on a specific frame, large enough to be worth pressing. */
export const STEP_MS = 100

/** Shift plus an arrow. For crossing a quiet stretch without holding the key down. */
export const STEP_COARSE_MS = 1_000

export type Playback = {
  isPlaying: boolean
  speed: PlaybackSpeed
  toggle: () => void
  pause: () => void
  setSpeed: (speed: PlaybackSpeed) => void
  /** Nudge the playhead by a signed delta, as the arrow keys do. */
  step: (deltaMs: number) => void
}

/**
 * Play, pause and speed, held in local state.
 *
 * Not in the store, and not only because `SessionState` is frozen: none of it is the agent's business.
 * A tool that could read `isPlaying` would start branching on it, and a tool that could *write* it would
 * be taking the human's hand off the controls to no purpose — `seek` already plays a bounded stretch
 * when the agent wants motion.
 */
export function usePlayback(): Playback {
  const recordingId = useSessionStore((s) => s.recording?.id ?? null)
  const durationMs = useSessionStore((s) => s.recording?.durationMs ?? 0)

  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState<PlaybackSpeed>(1)

  /** A different recording is a different clock. Playing into it would start it mid-air. */
  useEffect(() => {
    setIsPlaying(false)
  }, [recordingId])

  useEffect(() => {
    if (!isPlaying || durationMs <= 0) return

    const timer = setInterval(() => {
      // Read imperatively rather than from a captured render: the interval outlives the render that
      // created it, and a stale `currentTime` in this closure would make playback restart every tick.
      const next = useSessionStore.getState().currentTime + TICK_MS * speed

      if (next >= durationMs) {
        sessionActions().setCurrentTime(durationMs, 'human')
        setIsPlaying(false)
        return
      }

      sessionActions().setCurrentTime(next, 'human')
    }, TICK_MS)

    return () => clearInterval(timer)
  }, [isPlaying, speed, durationMs])

  return {
    isPlaying,
    speed,
    pause: () => setIsPlaying(false),
    setSpeed,

    toggle: () => {
      if (isPlaying) {
        setIsPlaying(false)
        return
      }
      if (durationMs <= 0) return

      // Parked at the end, so play means play again rather than nothing at all.
      if (useSessionStore.getState().currentTime >= durationMs) {
        sessionActions().setCurrentTime(0, 'human')
      }
      setIsPlaying(true)
    },

    step: (deltaMs) => {
      setIsPlaying(false)
      sessionActions().setCurrentTime(useSessionStore.getState().currentTime + deltaMs, 'human')
    },
  }
}

// ---------------------------------------------------------------------------
// Who moved it
// ---------------------------------------------------------------------------

/**
 * Who moved the playhead last, or null before anything has.
 *
 * Derived rather than stored, and the derivation is exact rather than a heuristic: `setCurrentTime`
 * appends a feed entry for an agent seek and appends nothing for a human's, so an update that changed
 * `currentTime` *and* replaced `activity` came from the agent, and one that changed only `currentTime`
 * came from the human. Coalesced agent seeks still replace the array with a new one (the store never
 * mutates in place), so a tool walking the timeline in a loop stays correctly attributed throughout.
 *
 * Watching for a description starting `seeked to` would have been the obvious version and is wrong: the
 * human's own seeks are silent, so the agent's line stays newest across everything the human does
 * afterwards, and the indicator would keep crediting the agent for a playhead a person had since moved.
 */
export function useLastSeekAuthor(): Author | null {
  const [author, setAuthor] = useState<Author | null>(null)

  useEffect(
    () =>
      useSessionStore.subscribe((state, previous) => {
        // A fresh recording resets the playhead to 0 and nobody has moved it yet.
        if (state.recording !== previous.recording) {
          setAuthor(null)
          return
        }
        if (state.currentTime === previous.currentTime) return
        setAuthor(state.activity === previous.activity ? 'human' : 'agent')
      }),
    [],
  )

  return author
}
