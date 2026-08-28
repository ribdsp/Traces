'use client'

import { useEffect, useState } from 'react'
import { AuthorBadge } from '@/components/ui/author-badge'
import { formatSeconds } from '@/components/ui/format-time'
import { sessionActions, useSessionStore } from '@/lib/store/session'
import { answerReportReview, hasPendingReportReview } from '@/lib/webmcp/tools/propose-report'
import type { Recording, Report } from '@/types/domain'

/**
 * The output of the whole investigation: a bug report the human can approve, edit, or copy.
 *
 * Pairs with `propose_report`.
 *
 * One rule this component must not soften: a step with `verified: false` is rendered **as unverified**,
 * next to the verified ones. `buildReport` marks a step unverified when no recorded event supports it,
 * which usually means the agent inferred it. Hiding those steps produces a report that reads as fully
 * evidenced when part of it is a guess, and that is the exact failure this project is arguing against —
 * a plausible bug report nobody can check.
 *
 * Every timestamp is clickable and seeks. A report whose claims can be verified in one click is the
 * artefact worth ending the demo on.
 *
 * What shipped, and why:
 *   - every field of `Report`, with each timestamp a seek
 *   - unverified steps say the word and explain it in a sentence, once, under the list. Colour alone would
 *     leave the distinction to whoever noticed the amber, and it is the most important distinction here.
 *   - copy as Markdown, which is what actually happens to a report — it gets pasted into a tracker
 *   - title and summary editable in place, and **held locally until approval**. That is not a stylistic
 *     choice: `propose_report` watches the store and treats *any* human-authored `setReport` as an approval
 *     with edits (see its `watchForHuman` detector), so writing on every keystroke would approve the draft
 *     on the first character typed. Local until approve, then exactly one write.
 *   - approve and reject, both through `answerReportReview`, which is the seam the tool documents for this
 *     component. `Report` has no `approved` field and `types/domain.ts` is frozen, so the decision cannot
 *     live in the store — which is also why "approved" below is local state.
 */

type Decision = { kind: 'approved' | 'rejected'; reached: boolean }

export function ReportDraft() {
  const report = useSessionStore((s) => s.report)
  const recording = useSessionStore((s) => s.recording)

  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [decision, setDecision] = useState<Decision | null>(null)
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null)

  /** A new draft replaces the old one wholesale, so the editable copy follows the store rather than persisting. */
  useEffect(() => {
    setTitle(report?.title ?? '')
    setSummary(report?.summary ?? '')
    setDecision(null)
    setCopied(null)
  }, [report])

  if (!report) return null

  const edited = title !== report.title || summary !== report.summary
  /*
   * Read on every render rather than kept in state. Every transition that can flip it — the draft arriving,
   * the human deciding, the watcher settling the gate — goes through the store or through the local state
   * below, so a render always follows it. A gate that times out deliberately keeps its review open, so there
   * is no silent third case to poll for.
   */
  const awaitingAgent = hasPendingReportReview()

  const commit = (approved: boolean) => {
    /*
     * Captured before the write, because the write is what settles the gate: a human-authored `setReport`
     * resolves the review as approved-with-edits, after which `answerReportReview` correctly reports that
     * nothing is waiting any more. Reading its return value to decide whether the agent heard us would
     * therefore say "nobody was listening" on exactly the path that worked.
     */
    const reached = awaitingAgent

    // The edit and the approval are one act: this write *is* what settles the gate as approved-with-edits.
    if (approved && edited) {
      sessionActions().setReport({ ...report, title: title.trim(), summary: summary.trim() }, 'human')
    }

    // A no-op when the write above already settled it, and the only path for an unedited approval.
    answerReportReview({ approved })
    setDecision({ kind: approved ? 'approved' : 'rejected', reached })
  }

  const copy = () => {
    const markdown = toMarkdown(report, { title, summary }, recording)

    // Absent on an insecure origin, which is how this gets demoed over a LAN address more often than not.
    if (typeof navigator.clipboard === 'undefined') {
      setCopied('failed')
      return
    }

    void navigator.clipboard
      .writeText(markdown)
      .then(() => setCopied('ok'))
      .catch(() => setCopied('failed'))
  }

  const unverified = report.steps.filter((step) => !step.verified).length

  return (
    <section className="border-b border-zinc-800 p-3">
      <div className="mb-1.5 flex items-baseline gap-1">
        <h2 className="text-[11px] uppercase tracking-wide text-zinc-500">Report draft</h2>
        <AuthorBadge author={report.author} />
        {awaitingAgent ? (
          <span className="ml-auto text-[10px] text-amber-300/80">waiting on your decision</span>
        ) : decision !== null ? (
          <span className="ml-auto text-[10px] text-zinc-500">{decision.kind}</span>
        ) : null}
      </div>

      {/*
        Editable in place: it reads as text until it has focus. A titled box with a pencil icon would make
        editing look like a mode, and the common case is fixing four words in the agent's title.
      */}
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        aria-label="Report title"
        className="w-full border border-transparent bg-transparent text-xs font-medium text-zinc-100 hover:border-zinc-800 focus:border-zinc-600 focus:outline-none"
      />

      <textarea
        value={summary}
        onChange={(event) => setSummary(event.target.value)}
        rows={2}
        placeholder="No summary. Add one — it is the first thing whoever picks this up will read."
        aria-label="Report summary"
        className="mt-1 w-full resize-none border border-transparent bg-transparent text-xs leading-relaxed text-zinc-400 placeholder:text-zinc-600 hover:border-zinc-800 focus:border-zinc-600 focus:outline-none"
      />

      {edited ? (
        <p className="flex items-baseline gap-1 text-[10px] text-zinc-500">
          <span>Your wording, not the agent’s.</span>
          <button
            type="button"
            onClick={() => {
              setTitle(report.title)
              setSummary(report.summary)
            }}
            className="underline decoration-dotted hover:text-zinc-200"
          >
            Restore the agent’s
          </button>
        </p>
      ) : null}

      <Field label="Steps to reproduce">
        <ol className="space-y-1">
          {report.steps.map((step, index) => (
            <li key={`${index}-${step.text}`} className="flex items-baseline gap-1.5 text-xs">
              <span className="shrink-0 font-mono text-[10px] text-zinc-600">{index + 1}</span>
              <span className={step.verified ? 'text-zinc-300' : 'text-zinc-400'}>{step.text}</span>

              {step.atMs !== undefined ? <Timestamp atMs={step.atMs} /> : null}

              {step.verified ? null : (
                <span className="shrink-0 border border-amber-500/40 px-1 text-[9px] uppercase tracking-wide text-amber-300">
                  unverified
                </span>
              )}
            </li>
          ))}
        </ol>

        {unverified > 0 ? (
          <p className="mt-1.5 border-l border-amber-500/40 pl-2 text-[10px] leading-relaxed text-zinc-500">
            {unverified === 1 ? 'One step is' : `${unverified} steps are`} marked unverified: no recorded
            event in this session matches {unverified === 1 ? 'it' : 'them'}, so the agent inferred{' '}
            {unverified === 1 ? 'it' : 'them'} rather than finding {unverified === 1 ? 'it' : 'them'}. Check{' '}
            {unverified === 1 ? 'it' : 'those'} against the replay before sending this on.
          </p>
        ) : null}
      </Field>

      {report.expected ? <Field label="Expected">{prose(report.expected)}</Field> : null}
      {report.actual ? <Field label="Actual">{prose(report.actual)}</Field> : null}
      {report.rootCause ? <Field label="Root cause">{prose(report.rootCause)}</Field> : null}

      {report.evidence.length > 0 ? (
        <Field label="Evidence">
          <ul className="space-y-0.5">
            {report.evidence.map((item, index) => (
              <li key={`${item.atMs}-${index}`} className="flex items-baseline gap-1.5 text-xs">
                <Timestamp atMs={item.atMs} />
                <span className="text-zinc-400">{item.note}</span>
              </li>
            ))}
          </ul>
        </Field>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => commit(true)}
          title={
            awaitingAgent
              ? edited
                ? 'Send the report back approved, with your wording.'
                : 'Send the report back approved. This is what the agent’s call is waiting on.'
              : 'No agent is waiting on this draft, but your edits are still recorded.'
          }
          className="border border-sky-500/50 bg-sky-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-sky-200 hover:border-sky-400"
        >
          {edited ? 'approve with edits' : 'approve'}
        </button>

        {/*
          A draft that can only be approved is a draft a human has to wait out the gate to disagree with. The
          tool has a rejection path with its own instruction to the agent — this is the button that uses it.
        */}
        <button
          type="button"
          onClick={() => commit(false)}
          title="Tell the agent the draft is not good enough. It is asked what to support better, not to resend it."
          className="border border-zinc-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500 hover:border-zinc-600 hover:text-zinc-200"
        >
          reject
        </button>

        <button
          type="button"
          onClick={copy}
          title="Copy the report as Markdown, ready to paste into a tracker."
          className="ml-auto border border-zinc-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400 hover:border-zinc-600 hover:text-zinc-100"
        >
          {copied === 'ok' ? 'copied' : 'copy as markdown'}
        </button>
      </div>

      {copied === 'failed' ? (
        <p role="alert" className="mt-1 text-[10px] text-rose-300">
          The browser refused clipboard access. Select the report text and copy it by hand.
        </p>
      ) : null}

      {decision !== null && !awaitingAgent ? (
        <p className="mt-1 text-[10px] leading-relaxed text-zinc-600">
          {!decision.reached
            ? 'No agent was waiting on this draft, so there was nothing to answer. Anything you changed is still saved above.'
            : decision.kind === 'approved'
              ? 'Approved. The agent has the version above, including anything you changed.'
              : 'Rejected. The agent was told the draft is not accepted, rather than being left waiting.'}
        </p>
      ) : null}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-2">
      <h3 className="text-[9px] uppercase tracking-wide text-zinc-600">{label}</h3>
      <div className="mt-0.5">{children}</div>
    </div>
  )
}

function prose(text: string) {
  return <p className="text-xs leading-relaxed text-zinc-300">{text}</p>
}

/** Every time in the report is a seek. Checking a claim has to cost one click, or nobody checks. */
function Timestamp({ atMs }: { atMs: number }) {
  return (
    <button
      type="button"
      onClick={() => sessionActions().setCurrentTime(atMs, 'human')}
      title={`Seek to ${atMs}ms`}
      className="shrink-0 font-mono text-[10px] text-sky-300 underline decoration-dotted hover:text-sky-200"
    >
      {formatSeconds(atMs)}
    </button>
  )
}

/**
 * The report as Markdown.
 *
 * Timestamps stay as seconds *and* milliseconds: the seconds match what is on screen, and the milliseconds
 * are what someone re-running `bisect` or `read_dom_at` needs to type. Unverified steps carry their caveat
 * into the paste, because that is where the report stops being ours and starts being someone else's evidence.
 */
function toMarkdown(
  report: Report,
  edits: { title: string; summary: string },
  recording: Recording | null,
): string {
  const lines: string[] = [`# ${edits.title.trim() || report.title}`, '']

  const summary = edits.summary.trim()
  if (summary) lines.push(summary, '')

  lines.push('## Steps to reproduce', '')
  report.steps.forEach((step, index) => {
    const at = step.atMs === undefined ? '' : ` (${formatSeconds(step.atMs)} / ${step.atMs}ms)`
    const caveat = step.verified ? '' : ' — **unverified**: no recorded event supports this step'
    lines.push(`${index + 1}. ${step.text}${at}${caveat}`)
  })
  lines.push('')

  if (report.expected) lines.push('## Expected', '', report.expected, '')
  if (report.actual) lines.push('## Actual', '', report.actual, '')
  if (report.rootCause) lines.push('## Root cause', '', report.rootCause, '')

  if (report.evidence.length > 0) {
    lines.push('## Evidence', '')
    for (const item of report.evidence) {
      lines.push(`- ${formatSeconds(item.atMs)} / ${item.atMs}ms — ${item.note}`)
    }
    lines.push('')
  }

  lines.push(
    recording === null
      ? '_Drafted in Traces. Times are relative to the start of the recording._'
      : `_Drafted in Traces from recording \`${recording.id}\`. Times are relative to the start of the recording._`,
  )

  return lines.join('\n')
}
