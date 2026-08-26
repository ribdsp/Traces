import { Replayer } from 'rrweb'
import type { eventWithTime } from '@rrweb/types'
import type { Recording } from '@/types/domain'

/**
 * A thin, typed wrapper over the rrweb Replayer.
 *
 * Owner: Riko.
 *
 * Why a wrapper at all: `mirrorDocument()` is the load-bearing method of the whole project. The
 * replayed page lives in an iframe that the Replayer creates itself, which makes it same-origin and
 * therefore readable from our code. Everything Traces can answer that a server cannot rests on that
 * one fact.
 *
 * VERIFIED — spike S2, rrweb 2.0.0-alpha.18, Chromium, against a real recording:
 *   - the Replayer's iframe carries `sandbox="allow-same-origin"` and `contentDocument` is reachable
 *     from the host realm. R5 holds; the idea is sound.
 *   - the replayed document is a *different realm*: `element instanceof HTMLSelectElement` is `false`
 *     against this frame's constructor and `true` against the iframe's own. See `mirrorDocument`.
 *   - `gotoTime` needs no frame wait, and no checkpoint arithmetic. See `gotoTime`.
 *
 * If R5 had failed, the fallback was rebuilding snapshots with `rrweb-snapshot` outside a Replayer.
 * Keeping every rrweb call behind this interface is what would have made that a one-file change; it is
 * kept behind the interface still, because `Replayer` is an alpha and its seek semantics are the kind
 * of thing a patch release changes.
 */
export type ReplayEngine = {
  /** Replay to a recording-relative time. Once it resolves, `mirrorDocument()` reflects that moment. */
  gotoTime: (atMs: number) => Promise<void>
  /** The replayed document. Same-origin and queryable — but a foreign realm; see the note on the impl. */
  mirrorDocument: () => Document
  /** Current playhead position, recording-relative ms. */
  currentTime: () => number
  destroy: () => void
}

export type ReplayEngineOptions = {
  /** The element the Replayer mounts into. Owned by ReplayStage. */
  mount: HTMLElement
  recording: Recording
  /**
   * From `buildCheckpointIndex`. No longer used for seeking — kept because it is part of a published
   * seam that `components/player/replay-stage.tsx` passes as an object literal, so removing the field
   * would put a type error in a file this area doesn't own. See `gotoTime` for what replaced it.
   */
  checkpoints: number[]
}

/**
 * Builds the Replayer, mounted into `mount`, and wraps it as a `ReplayEngine`.
 *
 * `recording.events` is typed as the structural minimum `RrwebEvent` (see types/domain.ts) precisely
 * so the rest of `lib/` never needs the rrweb package. This is the one file that bridges back to
 * rrweb's real discriminated-union event type — through `unknown`, never `any`, because the bridge is
 * real: this project's own recorder is what produced these events in rrweb's shape in the first
 * place, so the assertion is a claim about provenance, not a way to silence the type checker.
 *
 * Deliberately no test file alongside this one, and that is still the right call after the spike. Every
 * other file in lib/replay/ is tested with jsdom fixtures because its logic doesn't need a browser.
 * This function's entire job is orchestrating a real rrweb Replayer against a real iframe, and jsdom
 * implements neither the iframe document lifecycle nor layout — a test built from jsdom stand-ins here
 * would pass or fail on the mock rather than on rrweb. What this file needed was a browser, and it has
 * now had one: every claim below is annotated with what was measured.
 */
export function createReplayEngine(options: ReplayEngineOptions): ReplayEngine {
  const { mount, recording } = options

  const events = recording.events as unknown as eventWithTime[]
  const replayer = new Replayer(events, {
    root: mount,
    speed: 1,
    skipInactive: false,
    mouseTail: false,
  })

  /**
   * Whether a seek has happened yet.
   *
   * This exists because of the single nastiest thing the spike turned up. Immediately after
   * construction, before any seek, the iframe's `contentDocument` is **not null** and its `body` **is
   * present** — it is simply empty (`body.children.length === 0`, 13 characters of `outerHTML`). A
   * null-check therefore passes, `compressDom` runs happily on an empty tree, and the agent is told
   * the button it asked about does not exist at that moment. It does exist; the replay just hadn't
   * started. A confidently-wrong answer about the DOM is the one failure mode this project cannot
   * ship, and it is worse than a thrown error by a wide margin, because nothing downstream can detect
   * it.
   */
  let hasSeeked = false

  /**
   * The replayed document.
   *
   * Two things about the value that comes back, both measured rather than assumed:
   *
   * 1. It is same-origin and fully queryable. `querySelector`, `getAttribute`, `.value`,
   *    `querySelectorAll('option').length` and `getBoundingClientRect()` all work, and the geometry is
   *    real — a button measured 21.2 px tall, where jsdom reports zeros.
   *
   * 2. It belongs to a **different realm**, so `instanceof` against this frame's constructors lies.
   *    Measured: for a real `<select>` in the replay, `el instanceof HTMLSelectElement` is `false`
   *    here, while `el instanceof iframe.contentWindow.HTMLSelectElement` is `true`. Anything reading
   *    this document must branch on `element.tagName === 'SELECT'`, never on `instanceof` — which is
   *    what lib/dom/compress-dom.ts and lib/bisect/predicate.ts already do, and now for a proven
   *    reason rather than a suspected one. Note this applies to globals too: use the iframe's own
   *    `CSS` / `getComputedStyle` if you need them, not this frame's.
   */
  function mirrorDocument(): Document {
    const doc = replayer.iframe.contentDocument
    if (!doc) {
      throw new Error('mirrorDocument: the replay iframe has no contentDocument yet.')
    }
    if (!hasSeeked) {
      throw new Error(
        'mirrorDocument: no seek has happened yet, so the replayed document is still empty. ' +
          'Call gotoTime(atMs) first — reading now would report an empty DOM as if it were the page.',
      )
    }
    return doc
  }

  /**
   * Position the replay at `atMs`.
   *
   * Two Day-2 assumptions were wrong here, and the spike measured both:
   *
   * **No frame wait is needed.** `play(atMs)` followed by `pause(atMs)` applies the seek's mutations
   * synchronously; a read on the very next line already sees them. Across 60 deterministic offsets,
   * seeking both forwards and backwards, a synchronous read and a read after two animation frames
   * agreed 60/60 — on attributes, on inserted and removed nodes, on live `input.value`, on text
   * content, and on `getBoundingClientRect()`. Dropping the wait took a probe from 13.88 ms to
   * 0.35 ms. The wait was also never the safety net it looked like: one frame does not wait for a
   * subresource either, so a late-loading `<img>` could always reflow the page after a geometry read,
   * and removing the wait loses no guarantee that was ever actually there.
   *
   * **The checkpoint detour was a pessimisation, not an optimisation.** This used to seek to
   * `nearestCheckpointBefore(checkpoints, atMs)` and then pause at `atMs`, on the reasoning that it was
   * cheap and made use of the index. Measured over 40 offsets it produced byte-identical DOM state and
   * ran **73× slower** — 2.06 ms against 0.028 ms — because it forces rrweb to replay forward from the
   * checkpoint instead of letting it pick its own starting snapshot, which it does better. The
   * checkpoint index is still the right idea and still earns its place in the timeline UI; it just
   * should not be second-guessing the Replayer's own seek.
   *
   * Still `async` on purpose. The signature is a published seam that the tools already `await`, and
   * `Replayer` is an alpha whose seek semantics are exactly the sort of thing that changes under a
   * patch bump — keeping the promise means restoring a wait would not ripple into every caller.
   */
  async function gotoTime(atMs: number): Promise<void> {
    replayer.pause()
    replayer.play(atMs)
    replayer.pause(atMs)
    hasSeeked = true
  }

  function currentTime(): number {
    return replayer.getCurrentTime()
  }

  function destroy(): void {
    replayer.destroy()
  }

  return { gotoTime, mirrorDocument, currentTime, destroy }
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
 * The same applies to the two errors `mirrorDocument` can throw: both mean "not ready yet, retry",
 * and neither should reach the agent as a stack trace.
 */
export function getActiveEngine(): ReplayEngine | null {
  return activeEngine
}
