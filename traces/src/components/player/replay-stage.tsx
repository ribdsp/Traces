'use client'

import 'rrweb/dist/style.css'

import { useEffect, useRef, useState } from 'react'
import { MarkPointOverlay } from '@/components/player/mark-point-overlay'
import { SAMPLE_RECORDINGS } from '@/components/ui/sample-recordings'
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
 * Which is why the mount is sized in *recorded* pixels and shrunk with a CSS transform, rather than
 * being handed the size of our panel. The transform is visual only: the iframe's viewport stays exactly
 * as recorded, so a bug that depends on how the page was laid out still reproduces. Resizing the iframe
 * to fit our panel would reflow the recorded page, which is the version of this that quietly makes the
 * evidence wrong.
 *
 * The stylesheet is rrweb's rather than rrweb-player's, because the engine mounts a bare `Replayer`.
 * rrweb-player's sheet is the same replayer rules plus a controller bar we never render.
 */

/** Never magnify. The replay is evidence, and 1:1-or-smaller keeps what you see at most the truth. */
const MAX_SCALE = 1

export function ReplayStage() {
  const frameRef = useRef<HTMLDivElement>(null)
  const mountRef = useRef<HTMLDivElement>(null)
  const recording = useSessionStore((s) => s.recording)
  const checkpoints = useSessionStore((s) => s.checkpoints)

  const [available, setAvailable] = useState<{ width: number; height: number } | null>(null)
  const [engineError, setEngineError] = useState<string | null>(null)

  /** Content box, so the frame's own padding is already subtracted. */
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) setAvailable({ width: rect.width, height: rect.height })
    })

    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount || !recording) return

    setEngineError(null)

    /**
     * A failed construction has to say so on screen. It is reachable from a malformed recording as
     * well as from rrweb itself throwing, and the alternative is a blank panel next to a timeline that
     * looks like it is working.
     */
    let engine
    try {
      engine = createReplayEngine({ mount, recording, checkpoints })
    } catch (error) {
      setEngineError(error instanceof Error ? error.message : String(error))
      return
    }

    setActiveEngine(engine)

    return () => {
      setActiveEngine(null)
      engine.destroy()
    }
    // Keyed on the recording only: currentTime changes constantly and must not rebuild the Replayer.
  }, [recording, checkpoints])

  const viewport = recording?.meta.viewport
  const scale =
    viewport && available && viewport.width > 0 && viewport.height > 0
      ? Math.min(available.width / viewport.width, available.height / viewport.height, MAX_SCALE)
      : MAX_SCALE

  return (
    <div
      ref={frameRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden bg-zinc-950 p-3"
    >
      {recording && viewport ? (
        <div
          /** Sized to what the scale actually occupies, so centring is not thrown off by the transform. */
          className="relative overflow-hidden ring-1 ring-zinc-800"
          style={{ width: viewport.width * scale, height: viewport.height * scale }}
        >
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{ width: viewport.width, height: viewport.height, transform: `scale(${scale})` }}
          >
            <div ref={mountRef} className="traces-replay-mount" />
          </div>
        </div>
      ) : (
        <StageEmptyState />
      )}

      {recording && viewport ? (
        <p className="absolute bottom-1 right-2 font-mono text-[10px] text-zinc-600">
          {viewport.width}×{viewport.height} · {Math.round(scale * 100)}%
        </p>
      ) : null}

      {engineError ? <StageErrorState message={engineError} /> : null}

      {/*
        The gate lives inside the overlay, which renders nothing while `pendingAsk` is null. Reading
        the same flag here as well would be a second source of truth for "is the agent waiting", and
        those two drift.
      */}
      <MarkPointOverlay />
    </div>
  )
}

/**
 * The first thing a judge sees, so it reads as a starting point rather than as a blank panel: what
 * this is, what is on offer, and the one action that gets them moving.
 */
function StageEmptyState() {
  return (
    <div className="max-w-md px-6 text-xs leading-relaxed">
      <p className="text-zinc-300">No recording loaded.</p>
      <p className="mt-1 text-zinc-500">
        Traces replays a recorded browser session and lets an agent interrogate it — read the DOM at any
        moment, binary-search the timeline, ask a human to look. Pick a sample from the header to start.
      </p>

      <ul className="mt-3 space-y-1.5">
        {SAMPLE_RECORDINGS.map((sample) => (
          <li key={sample.id}>
            <span className="font-mono text-[11px] text-zinc-400">{sample.id}</span>
            <span className="block text-zinc-600">{sample.blurb}</span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-zinc-600">
        Or record your own against <span className="font-mono">bugbait</span> — README, “Making your own
        recordings”.
      </p>
    </div>
  )
}

/** Construction failed. Says which recording and what threw, because both narrow it immediately. */
function StageErrorState({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="absolute inset-x-3 bottom-3 border border-rose-500/50 bg-rose-950/80 px-3 py-2 text-[11px] text-rose-100"
    >
      <p className="font-medium">The replay engine did not start.</p>
      <p className="mt-0.5 font-mono text-rose-200/80">{message}</p>
      <p className="mt-1 text-rose-200/70">
        The timeline and the tool surface are still live, but nothing can read the DOM until this is
        fixed. Reload after loading a different recording.
      </p>
    </div>
  )
}

/** Kept next to the mount so the "who moves the playhead" answer stays in one file. */
export function seekTo(atMs: number, author: 'human' | 'agent'): void {
  sessionActions().setCurrentTime(atMs, author)
}
