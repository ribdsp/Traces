import type { Author, DigestEvent, Recording, Report, ReportStep } from '@/types/domain'
import { buildEventDigest } from '@/lib/replay/event-digest'

/**
 * Reconstruct a bug report from what was actually recorded.
 *
 * The one rule that makes this worth building rather than asking the model to write prose: **every
 * reproduction step is validated against the event stream**, and a step with no supporting event is
 * marked `verified: false` rather than dropped.
 *
 * Keeping unverifiable steps visible is the deliberate choice. A model asked for repro steps will
 * cheerfully produce "the user then selected their province" because it is the obvious next step in
 * the story — and a report that silently omits it reads as complete, while one that shows it as
 * unverified tells the engineer exactly where to look. Fabricated steps are the failure mode most
 * likely to make a human distrust the whole tool, and the only defence is admitting the gap.
 *
 * What shipped, and the decisions behind it — each is also called out
 * inline, next to the code that makes it:
 *   - `proposed.steps` (when present) are checked against the recording's own event digest, one at a
 *     time, and re-emitted with a recomputed `verified` — see `reconcileStep`. The caller's own
 *     `verified` value on an incoming step is never trusted; this function is the only place that
 *     sets it.
 *   - when `proposed.steps` is empty or absent, steps are synthesized directly from the digest
 *     instead of left empty — see `synthesizeStepsFromDigest` for why those are `verified: true`
 *     unconditionally.
 *   - `actual`, `rootCause`, `evidence`, `summary`, `title` pass through from `proposed` with `''`
 *     defaults for whatever is missing — deriving *those* from promoted hypotheses is the caller's
 *     job (this function only ever sees `recording` and `proposed`, per its signature); this function
 *     only guarantees they come back as the strings the type promises, never `undefined`.
 *   - `author` is forced to `'agent'` — see the constant below for why.
 *   - rendering as Markdown happens elsewhere; this returns data, not a string.
 */

/**
 * How close a proposed step's claimed `atMs` has to be to a real digest event to count as
 * "supported." Named and exported so the tradeoff is visible rather than buried in an inline number.
 *
 * 2 seconds. Related events in the same recording don't share a single timestamp even when they
 * describe the same moment — a click, the mutation it causes, and a follow-up input can each land a
 * few hundred milliseconds apart — so a window tight enough to require exact agreement (on the order
 * of `RAGE_CLICK_WINDOW_MS`'s 1000ms in event-digest.ts) would fail real, correctly-described steps
 * on timing jitter alone. Wide enough to span most of a short recording would let a fabricated
 * timestamp "verify" against any coincidentally nearby event, which defeats the point. 2 seconds is
 * short relative to the seconds-to-minutes span of a typical bug recording, while comfortably
 * covering the jitter between causally-related events.
 */
export const MATCH_WINDOW_MS = 2_000

/**
 * `author` on the returned `Report` is always `'agent'`, regardless of what `proposed.author` says.
 *
 * `Author` is the mechanism T7 (docs/threat-model.md) uses to keep the activity feed honest — it is
 * what lets a human tell agent contributions from their own and undo them individually. `buildReport`
 * exists specifically to turn *model-proposed* content into a validated `Report`; letting the caller
 * freely set `author` would let a report built from a model's proposal claim to be human-authored,
 * which is exactly the kind of unattributed change T7 is there to prevent. A human's approval of the
 * proposal is tracked as its own activity entry elsewhere, not by relabelling who drafted the report.
 */
const REPORT_AUTHOR: Author = 'agent'

/**
 * Digest kinds that describe something a *user did*, as opposed to something the system reported
 * happening to them. Reproduction steps are about the former.
 *
 * `consoleError`, `consoleWarn` and `failedRequest` are deliberately excluded: they are symptoms, not
 * actions, and belong in `actual`/`rootCause`/`evidence`, not in the list of things a person needs to
 * repeat to reproduce the bug. `rageClick` is included as a variant of `click` — it is still a click,
 * just several of them collapsed into one digest entry (see collapseRageClicks in event-digest.ts).
 *
 * The TODO this file started from asks for "clicks on interactive elements" specifically, but the
 * digest does not currently carry enough information to filter on that: `DigestEvent.selector` is
 * usually unset for clicks (event-digest.ts's own note — rrweb only carries a numeric node id), so
 * there is no element here to classify as interactive or not. Every click digest event is treated as
 * a step candidate until that lands.
 */
const STEP_EVENT_KINDS: DigestEvent['kind'][] = ['navigation', 'click', 'rageClick', 'input']

/**
 * The closest step-worthy event to `atMs`, if one exists within `MATCH_WINDOW_MS`. `undefined` when
 * nothing qualifies — the caller treats that as "no support," not as an error.
 */
function closestWithin(events: DigestEvent[], atMs: number, windowMs: number): DigestEvent | undefined {
  let best: DigestEvent | undefined
  let bestDistance = Infinity

  for (const event of events) {
    const distance = Math.abs(event.atMs - atMs)
    if (distance > windowMs) continue
    if (distance < bestDistance) {
      best = event
      bestDistance = distance
    }
  }

  return best
}

/**
 * Recompute `verified` (and `atMs`) for one proposed step against the recording's own step-worthy
 * events. This is the whole point of the file, so the reasoning is spelled out rather than left to be
 * inferred from the code:
 *
 * - **No `atMs` on the proposed step.** There is nothing to center "a small window" on, so there is
 *   nothing to search. Guessing a window from the step's position in the list, or from keywords in
 *   its prose, would just be text-based inference wearing a different hat — see the next point for
 *   why that is out. A step without a timestamp comes back `verified: false`, full stop.
 * - **Matching is time-only.** A step is checked against *whether any step-worthy event happened near
 *   its claimed moment*, never against whether the event's summary text resembles the step's prose.
 *   Text similarity is the trap named in this file's own brief: a model that writes confident,
 *   on-topic prose ("the user clicked the submit button") passes a similarity check as soon as *any*
 *   click happens nearby, which rewards good writing, not accuracy. Time proximity to a real event is
 *   the one signal here a fabricated-but-plausible sentence cannot talk its way around.
 * - **The claimed moment has to be inside the recording.** `MATCH_WINDOW_MS` reaches 2 seconds in
 *   both directions and knows nothing about where the recording stops, so without this a step timed
 *   past the end borrows the credibility of the last real event before it. Measured on a real 3598ms
 *   recording: "Click the pay button" at 5000ms came back `verified: true` with `atMs` rewritten to
 *   3596 — in a recording containing no clicks whatsoever. A moment the recording does not cover
 *   cannot have been witnessed, whatever happened to fire near it, and that is a different claim from
 *   "unsupported": it is unsupportable in principle.
 * - **What this still fails to catch, and it is more than it looks.** Matching ignores the event's
 *   content *and its kind*. `ReportStep` carries prose and a timestamp, nothing else, so there is no
 *   claimed kind to compare against the matched event's — the kind filter above narrows the candidate
 *   pool, it does not check the step. Measured on the same recording: a step reading "Navigate to the
 *   payment step" verified against an `input` event 328ms away, in a session with exactly one
 *   navigation, at 0ms. So `verified: true` on a proposed step means **"a real user action happened
 *   near this time"**, not "this step describes that action" — weaker than the word suggests, and the
 *   gap cannot be closed from inside this file: it needs a claimed `kind` on `ReportStep`, and
 *   `types/domain.ts` is a frozen contract. Recorded as a proposal, not a change. Target identity is
 *   unchecked for the same reason — `DigestEvent.selector` is usually unset for clicks (see
 *   `STEP_EVENT_KINDS` above).
 * - **A match rewrites `atMs` to the event's real timestamp, not the model's claim.**
 *   `ReportStep.atMs` is documented as "recording time this step was reconstructed from" — for a
 *   verified step, that is the matched event's timestamp, which may differ slightly from what the
 *   model guessed. For an unverified step, `atMs` is left unset entirely rather than passing the
 *   model's unconfirmed guess through: keeping it would let a fabricated timestamp look, to any code
 *   that reads `atMs` without also checking `verified`, exactly like a confirmed one.
 */
function reconcileStep(step: ReportStep, candidates: DigestEvent[], durationMs: number): ReportStep {
  if (step.atMs === undefined) {
    return { text: step.text, verified: false }
  }

  if (step.atMs < 0 || step.atMs > durationMs) {
    return { text: step.text, verified: false }
  }

  const supporting = closestWithin(candidates, step.atMs, MATCH_WINDOW_MS)
  if (!supporting) {
    return { text: step.text, verified: false }
  }

  return { text: step.text, atMs: supporting.atMs, verified: true }
}

/**
 * Steps built directly from the digest, used when the model proposed none.
 *
 * These are `verified: true` unconditionally, and that is not a shortcut: a step built this way *is*
 * a recorded event, restated, not a claim being checked against one. There is nothing to verify
 * because there is no separate assertion — the text comes from the same digest summary a human or
 * agent would see from `list_events`, which is already the threat-model-compliant rendering of that
 * event (input values are never in it, only lengths — docs/threat-model.md T4). This is the opposite
 * of the fabrication risk `reconcileStep` guards against: it is the recording speaking for itself
 * instead of a model's account of it.
 */
function synthesizeStepsFromDigest(events: DigestEvent[]): ReportStep[] {
  return events.map((event) => ({ text: event.summary, atMs: event.atMs, verified: true }))
}

export function buildReport(recording: Recording, proposed: Partial<Report>): Report {
  const { events } = buildEventDigest(recording)
  const stepWorthyEvents = events.filter((event) => STEP_EVENT_KINDS.includes(event.kind))

  const steps =
    proposed.steps && proposed.steps.length > 0
      ? proposed.steps.map((step) => reconcileStep(step, stepWorthyEvents, recording.durationMs))
      : synthesizeStepsFromDigest(stepWorthyEvents)

  return {
    title: proposed.title ?? '',
    summary: proposed.summary ?? '',
    steps,
    expected: proposed.expected ?? '',
    actual: proposed.actual ?? '',
    rootCause: proposed.rootCause ?? '',
    evidence: proposed.evidence ?? [],
    author: REPORT_AUTHOR,
  }
}
