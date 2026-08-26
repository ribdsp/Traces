import type { Recording, Report } from '@/types/domain'

/**
 * Reconstruct a bug report from what was actually recorded.
 *
 * Owner: Riko.
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
 * TODO(riko), Day 5:
 *   - derive steps from the digest: navigations, clicks on interactive elements, inputs (never the
 *     typed value — length and field name only, see docs/threat-model.md)
 *   - for each step the model proposed, find a supporting event within a small window; no match →
 *     verified: false
 *   - `actual` and `rootCause` come from promoted hypotheses, with their evidence timestamps
 *   - render as Markdown elsewhere; this function returns data
 */
export function buildReport(
  _recording: Recording,
  _proposed: Partial<Report>,
): Report {
  throw new Error('buildReport: not implemented')
}
