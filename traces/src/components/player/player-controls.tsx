'use client'

import { useSessionStore } from '@/lib/store/session'

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
 */
export function PlayerControls() {
  const currentTime = useSessionStore((s) => s.currentTime)
  const recording = useSessionStore((s) => s.recording)

  /**
   * TODO(faiq), Day 2:
   *   - play/pause, and 0.5× / 1× / 2× speed
   *   - a scrubber that writes through setCurrentTime(atMs, 'human') — never straight to the Replayer
   *   - a subtle marker when the last seek came from the agent, so a moving playhead nobody touched
   *     is explained rather than uncanny
   *   - keyboard: space to toggle, arrows to step. This gets used constantly while recording the demo
   */
  return (
    <div className="flex items-center gap-3 border-t border-zinc-800 px-3 py-2 text-xs text-zinc-400">
      <span className="font-mono tabular-nums">{(currentTime / 1000).toFixed(3)}s</span>
      <span className="text-zinc-600">/ {((recording?.durationMs ?? 0) / 1000).toFixed(3)}s</span>
      <span className="ml-auto text-zinc-600">placeholder controls</span>
    </div>
  )
}
