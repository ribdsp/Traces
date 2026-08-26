'use client'

import { useEffect, useRef } from 'react'
import { createReplayEngine, setActiveEngine } from '@/lib/replay/replay-engine'
import { sessionActions, useSessionStore } from '@/lib/store/session'

/**
 * Mounts the rrweb Replayer and publishes the engine so tools can drive it.
 *
 * Owner: Faiq (component), over Riko's lib/replay.
 *
 * This is the only component in the app that owns a non-React object with a lifecycle, so it is the
 * only one that needs care:
 *
 *   - the Replayer must be constructed **once per recording**, not once per render. Rebuilding it on
 *     every state change destroys the iframe the tools are holding, and the symptom is `mirrorDocument`
 *     returning a detached document with no error anywhere.
 *   - `setActiveEngine(null)` on unmount. A stale engine after hot reload points at a dead iframe, and
 *     debugging that costs an hour every time.
 *   - never render the recording's own scrollbars or a mouse tail: they move DOM around between
 *     probes, and bisect reads the DOM.
 *
 * The mount div must have real dimensions before the Replayer is constructed — rrweb reads them to
 * compute its scale, and a zero-height parent produces a player that is present, silent, and invisible.
 */
export function ReplayStage() {
  const mountRef = useRef<HTMLDivElement>(null)
  const recording = useSessionStore((s) => s.recording)
  const checkpoints = useSessionStore((s) => s.checkpoints)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount || !recording) return

    const engine = createReplayEngine({ mount, recording, checkpoints })
    setActiveEngine(engine)

    return () => {
      setActiveEngine(null)
      engine.destroy()
    }
    // Keyed on the recording only: currentTime changes constantly and must not rebuild the Replayer.
  }, [recording, checkpoints])

  /**
   * TODO(faiq), Day 2:
   *   - import 'rrweb-player/dist/style.css' once, here or in globals.css
   *   - fixed aspect box sized from recording.meta.viewport, so the replay isn't letterboxed oddly
   *   - empty state when `recording` is null: name the sample recordings and how to load one. This is
   *     the first thing a judge sees, so it should read as a starting point rather than as a blank panel
   *   - overlay MarkPointOverlay when the store has a pendingAsk
   */
  return (
    <div className="relative flex h-full w-full items-center justify-center bg-zinc-950">
      <div ref={mountRef} className="traces-replay-mount" />
      {!recording ? (
        <p className="absolute text-xs text-zinc-500">No recording loaded — placeholder, replace this.</p>
      ) : null}
    </div>
  )
}

/** Kept next to the mount so the "who moves the playhead" answer stays in one file. */
export function seekTo(atMs: number, author: 'human' | 'agent'): void {
  sessionActions().setCurrentTime(atMs, author)
}
