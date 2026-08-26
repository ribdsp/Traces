'use client'

import { useSessionStore } from '@/lib/store/session'
import { AuthorBadge } from '@/components/ui/author-badge'

/**
 * The output of the whole investigation: a bug report the human can approve, edit, or copy.
 *
 * Owner: Faiq. Pairs with `propose_report`.
 *
 * One rule this component must not soften: a step with `verified: false` is rendered **as unverified**,
 * next to the verified ones. `buildReport` marks a step unverified when no recorded event supports it,
 * which usually means the agent inferred it. Hiding those steps produces a report that reads as fully
 * evidenced when part of it is a guess, and that is the exact failure this project is arguing against —
 * a plausible bug report nobody can check.
 *
 * Every timestamp is clickable and seeks. A report whose claims can be verified in one click is the
 * artefact worth ending the demo on.
 */
export function ReportDraft() {
  const report = useSessionStore((s) => s.report)

  if (!report) return null

  /**
   * TODO(faiq), Day 5:
   *   - render title, summary, steps, expected, actual, root cause, evidence
   *   - unverified steps carry a visible marker and a one-line explanation of what "unverified" means.
   *     Do not use a warning colour alone; say the words
   *   - "Copy as Markdown" — the thing a real user actually does with this, and one of the few places
   *     a keyboard-reachable button matters more than the styling
   *   - title and summary editable in place, saved with author 'human' so the edit is attributed
   *   - approve resolves the tool's gate; that resolution is what the agent is waiting on
   */
  return (
    <section className="p-3">
      <div className="mb-1 flex items-baseline gap-1">
        <h2 className="text-[11px] uppercase tracking-wide text-zinc-500">Report draft</h2>
        <AuthorBadge author={report.author} />
      </div>

      <h3 className="text-xs font-medium text-zinc-100">{report.title}</h3>
      <p className="mt-1 text-xs text-zinc-400">{report.summary}</p>

      <ol className="mt-2 space-y-1">
        {report.steps.map((step, index) => (
          <li key={`${index}-${step.text}`} className="text-xs text-zinc-300">
            {step.text}
            {step.verified ? null : <span className="ml-1 text-[10px] text-amber-300">unverified</span>}
          </li>
        ))}
      </ol>
    </section>
  )
}
