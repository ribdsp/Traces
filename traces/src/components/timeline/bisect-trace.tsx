'use client'

import { useSessionStore } from '@/lib/store/session'

/**
 * The binary search, drawn.
 *
 * Owner: Faiq.
 *
 * The most persuasive four seconds of the demo, and the reason to build it properly. Each probe
 * appears in order, the searched window visibly halves, and the answer converges on a millisecond.
 * A viewer who has never heard of WebMCP watches a search happen inside a web page and understands
 * immediately that the agent is not fetching an answer from somewhere — it is making the page compute
 * one.
 *
 * Animate in trace order with a short stagger (~80ms). Rendering all six probes at once shows the
 * result but not the search, which is the part worth showing.
 */
export function BisectTrace() {
  const trace = useSessionStore((s) => s.bisectTrace)
  const recording = useSessionStore((s) => s.recording)

  if (!recording || trace.length === 0) return null

  /**
   * TODO(faiq), Day 4:
   *   - one dot per probe: false one way, true the other, and `elementMissing` visually distinct from
   *     both. "The element wasn't there" is not the same claim as "the condition was false", and the
   *     drawing shouldn't merge them
   *   - a bracket showing the window that survived each halving
   *   - the converged answer labelled with its millisecond value
   *   - stagger the entrance in trace order, and respect prefers-reduced-motion
   *   - clear when a new bisect starts: two overlaid traces are unreadable
   */
  return (
    <div className="absolute top-2 h-4 w-full">
      {trace.map((step, index) => (
        <span
          key={`${step.atMs}-${index}`}
          title={`probe ${index + 1}: ${step.atMs}ms → ${step.result}`}
          className={`absolute h-2 w-2 rounded-full ${step.result ? 'bg-zinc-100' : 'bg-zinc-600'}`}
          style={{ left: `${(step.atMs / recording.durationMs) * 100}%` }}
        />
      ))}
    </div>
  )
}
