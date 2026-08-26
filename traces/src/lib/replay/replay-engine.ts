import type { Recording } from '@/types/domain'

/**
 * A thin, typed wrapper over the rrweb Replayer.
 *
 * Owner: Riko.
 *
 * Why a wrapper at all: `mirrorDocument()` is the load-bearing method of the whole project. The
 * replayed page lives in an iframe that the Replayer creates itself, which makes it same-origin and
 * therefore readable from our code. Everything Traces can answer that a server cannot rests on that
 * one fact — spike S2 on Day 1 exists to prove it before anyone writes a tool.
 *
 * If it turns out not to hold, the fallback is rebuilding snapshots with `rrweb-snapshot` outside a
 * Replayer. Keeping every rrweb call behind this interface is what makes that fallback a one-file
 * change instead of a rewrite.
 */
export type ReplayEngine = {
  /** Replay to a recording-relative time and settle. Resolves once the DOM reflects that moment. */
  gotoTime: (atMs: number) => Promise<void>
  /** The live replayed document. Same-origin; queryable with ordinary DOM APIs. */
  mirrorDocument: () => Document
  /** Current playhead position, recording-relative ms. */
  currentTime: () => number
  destroy: () => void
}

export type ReplayEngineOptions = {
  /** The element the Replayer mounts into. Owned by ReplayStage. */
  mount: HTMLElement
  recording: Recording
  /** From buildCheckpointIndex. Used to start each seek from the nearest preceding snapshot. */
  checkpoints: number[]
}

/**
 * TODO(riko), Day 2:
 *   - construct `new Replayer(events, { root: mount, speed: 1, skipInactive: false, mouseTail: false })`
 *   - gotoTime: pause, seek from nearest checkpoint, then await the frame the Replayer applies
 *     mutations on. `play(offset)` followed by an immediate read returns the *previous* DOM — that
 *     off-by-one-frame is the likeliest source of a plausible-but-wrong bisect result
 *   - mirrorDocument: `replayer.iframe.contentDocument`, throwing a readable error if it is null
 */
export function createReplayEngine(_options: ReplayEngineOptions): ReplayEngine {
  throw new Error('createReplayEngine: not implemented')
}

/**
 * The seam between the component that owns the Replayer and the tools that need to drive it.
 *
 * `ReplayStage` creates the engine on mount and publishes it here; every tool that reads the DOM at a
 * moment in time collects it with `getActiveEngine()`. Both sides import this one module, so neither
 * has to know anything about the other.
 *
 * Why not put the engine in the zustand store: it isn't state. Nothing renders from it, it has no
 * meaningful previous value, and per-contribution undo over a live Replayer instance is nonsense. A
 * module-level handle says that plainly. The store holds what the UI draws; this holds the thing that
 * does the work.
 *
 * There is exactly one engine, because there is exactly one recording open at a time.
 */
let activeEngine: ReplayEngine | null = null

/** Called by ReplayStage on mount, and with `null` on unmount. */
export function setActiveEngine(engine: ReplayEngine | null): void {
  activeEngine = engine
}

/**
 * The engine, or `null` before the stage has mounted.
 *
 * Tools must handle `null` by returning a readable error rather than throwing — an agent that calls
 * `read_dom_at` while the page is still loading should be told to retry, not handed a stack trace.
 */
export function getActiveEngine(): ReplayEngine | null {
  return activeEngine
}
