import type { Report, ReportStep, SessionState } from '@/types/domain'
import { buildReport } from '@/lib/report/build-report'
import { sessionActions, sessionState } from '@/lib/store/session'
import { type ToolDefinition, type ToolResponse, json, noRecording, requireString, toolError } from '../tool-types'
import { answerGate, createGate } from '../blocking'
import {
  TICKET_FIELD,
  capList,
  capText,
  collectRetry,
  optionalString,
  pendingResponse,
  requireObjectArray,
  watchForHuman,
} from './tool-support'

/**
 * 'propose_report' — see docs/tools.md for the full contract.
 *
 * Owner: Vicko.
 *
 * Implemented — vicko, Day 5:
 *   - the draft goes through `buildReport` (lib/report) **before** anyone sees it. Steps are not
 *     validated here and must not be: that function checks every step against the real event stream and
 *     marks the unsupported ones `verified: false`, and a second opinion in this file could only
 *     disagree with it. This wrapper's job is to pass the model's draft through it and hand the human
 *     the result — including the parts the recording does not support.
 *   - `setReport(report, 'agent')`, then `createGate('report')` and a wait on the human's approval
 *   - the response reports which steps came back unverified, as something to act on
 *
 * **§14 input mismatch, mapped rather than obeyed.** docs/tools.md §14 documents
 * `{ title, steps: string[], evidence: number[], rootCause, domSnippet? }`, which is narrower than
 * `Report` in two ways that matter and one that cannot be fixed here:
 *   - `steps: string[]` carries no timestamp, and `buildReport` can only verify a step that claims one —
 *     a bare string is unverifiable *by construction*, so every step would come back unverified. Steps
 *     are therefore `{ text, atMs? }` here.
 *   - `evidence: number[]` loses the note that makes an evidence chip readable, so evidence is
 *     `{ atMs, note }`, matching `Report.evidence`.
 *   - `domSnippet` has no home: `Report` has no field for it and types/domain.ts is frozen. It is not
 *     declared below, so a model that sends one gets a schema error rather than having it silently
 *     dropped. Needs a `Report` field or a doc correction — someone else's call, not this file's.
 * `summary`, `expected` and `actual` are accepted because `Report` has them and a report without them
 * reads as half-written.
 */

export const REPORT_TITLE_MAX = 120
export const REPORT_PROSE_MAX = 600
export const REPORT_STEP_TEXT_MAX = 200

/** Twelve steps is a long repro; past that the report is a transcript and nobody follows it. */
export const REPORT_STEPS_MAX = 12
export const REPORT_EVIDENCE_MAX = 10

type ReportOutcome =
  /** `report` is whatever stood in the store when the human approved, edits included. */
  | { kind: 'approved'; report: Report; editedByHuman: boolean }
  | { kind: 'rejected' }
  /** A newer draft replaced this one, so this gate has nothing left to be approved. */
  | { kind: 'superseded' }

/**
 * The review this tool is currently waiting on, if any.
 *
 * There is at most one, because `SessionState.report` is a single slot. Held here so the UI has
 * something to call: unlike the other three blocking tools, "the human approved the draft" is not a
 * state change the store can represent — `Report` has no `approved` field and types/domain.ts is frozen
 * — so approval needs an explicit seam. See `answerReportReview`.
 */
let openReview: { ticket: string; cancel: () => void } | null = null

/** True while a draft is on screen with an agent waiting on it. Useful to the UI and to the inspector. */
export function hasPendingReportReview(): boolean {
  return openReview !== null
}

/**
 * The UI's way to answer `propose_report`. **This is what an Approve button must call.**
 *
 * Called from `components/agent/report-draft.tsx`. Returns false when nothing is waiting, which is a
 * legitimate outcome: the human may approve a draft the agent has already given up on.
 *
 * Editing the report through `setReport(edited, 'human')` also settles the gate on its own (see the
 * watcher below), so an Approve button that saves edits first and calls this second is safe — the gate
 * ignores the second answer, exactly as `answerGate` does for a double click.
 */
export function answerReportReview(decision: { approved: boolean }): boolean {
  const open = openReview
  if (open === null) return false

  const report = sessionState().report
  const outcome: ReportOutcome =
    decision.approved && report !== null
      ? { kind: 'approved', report, editedByHuman: report.author === 'human' }
      : { kind: 'rejected' }

  const delivered = answerGate<ReportOutcome>(open.ticket, outcome)
  if (delivered) {
    // Stop watching too: an approval delivered here means the store watcher below has nothing left to
    // do, and a watcher that outlives its gate would clear a *later* review's slot when it fired.
    open.cancel()
    openReview = null
  }
  return delivered
}

type ProposedStep = { text: string; atMs?: number }

function readSteps(entries: readonly Record<string, unknown>[]): { steps: ProposedStep[]; notes: string[] } | string {
  const bounded = capList(entries, REPORT_STEPS_MAX)
  const notes: string[] = []
  if (bounded.truncated) {
    notes.push(
      `Only the first ${REPORT_STEPS_MAX} of your ${entries.length} steps are in the draft. Give the shortest path ` +
        'that reproduces the bug, not the whole session.',
    )
  }

  const steps: ProposedStep[] = []
  for (const [index, entry] of bounded.items.entries()) {
    const text = entry['text']
    if (typeof text !== 'string' || text.trim().length === 0) {
      return `'steps[${index}].text' is required and must be a non-empty string.`
    }

    const atMs = entry['atMs']
    if (atMs !== undefined && (typeof atMs !== 'number' || !Number.isFinite(atMs))) {
      return `'steps[${index}].atMs', when given, must be a time in milliseconds from the start of the recording, e.g. 28412.`
    }

    const capped = capText(text, REPORT_STEP_TEXT_MAX)
    if (capped.truncated) {
      notes.push(`Step ${index + 1} was shortened to ${REPORT_STEP_TEXT_MAX} characters. Write steps as one action each.`)
    }

    steps.push({ text: capped.text, ...(typeof atMs === 'number' ? { atMs } : {}) })
  }

  return { steps, notes }
}

function readEvidence(value: unknown): { evidence: Report['evidence']; notes: string[] } | string {
  if (value === undefined || value === null) return { evidence: [], notes: [] }
  if (!Array.isArray(value)) {
    return "'evidence', when given, must be an array of objects like { \"atMs\": 28412, \"note\": \"province list empty\" }."
  }

  const bounded = capList(value as unknown[], REPORT_EVIDENCE_MAX)
  const notes: string[] = []
  if (bounded.truncated) {
    notes.push(`Only the first ${REPORT_EVIDENCE_MAX} evidence entries are in the draft. Cite the decisive moments.`)
  }

  const evidence: Report['evidence'] = []
  for (const [index, entry] of bounded.items.entries()) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return `'evidence[${index}]' must be an object like { "atMs": 28412, "note": "province list empty" }.`
    }

    const record = entry as Record<string, unknown>
    const atMs = record['atMs']
    if (typeof atMs !== 'number' || !Number.isFinite(atMs)) {
      return `'evidence[${index}].atMs' is required and must be a time in milliseconds from the start of the recording, e.g. 28412.`
    }

    const note = record['note']
    if (note !== undefined && typeof note !== 'string') {
      return `'evidence[${index}].note', when given, must be a string.`
    }

    evidence.push({ atMs: Math.round(atMs), note: capText(typeof note === 'string' ? note : '', 200).text })
  }

  return { evidence, notes }
}

function approvedResponse(
  outcome: Extract<ReportOutcome, { kind: 'approved' }>,
  notes: readonly string[],
): ToolResponse {
  const { report, editedByHuman } = outcome
  const steps = capList(report.steps, REPORT_STEPS_MAX)
  const unverified = report.steps.filter((step) => !step.verified).length

  const guidance: string[] = [...notes]
  if (unverified > 0) {
    guidance.push(
      `${unverified} of ${report.steps.length} steps are marked unverified: no recorded event supports them. ` +
        'Do not describe them to the user as reproduced. If you can find the event that supports one, call ' +
        'propose_report again with that step timestamped.',
    )
  }
  if (editedByHuman) {
    guidance.push('The human edited the draft before approving. Quote their wording, not yours.')
  }

  return json({
    status: 'answered',
    approved: true,
    editedByHuman,
    finalText: capText(`${report.title} — ${report.summary}`, REPORT_PROSE_MAX).text,
    steps: steps.items.map((step: ReportStep) => ({
      text: step.text,
      ...(step.atMs === undefined ? {} : { atMs: step.atMs }),
      verified: step.verified,
    })),
    unverifiedCount: unverified,
    ...(steps.truncated || guidance.length > 0 ? { truncated: steps.truncated } : {}),
    ...(guidance.length > 0 ? { nextStep: guidance.join(' ') } : {}),
  })
}

export const proposeReportTool: ToolDefinition = {
  name: 'propose_report',
  description: "Propose a bug report and wait for the human to approve or edit it. Reproduction steps are validated against the recorded events, and any step no event supports is marked unverified rather than quietly dropped.",

  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: `One line naming the bug, e.g. "Province dropdown is empty, so checkout cannot be completed". At most ${REPORT_TITLE_MAX} characters.`,
      },
      summary: {
        type: 'string',
        description: `A short paragraph on what happened and why it matters. At most ${REPORT_PROSE_MAX} characters.`,
      },
      steps: {
        type: 'array',
        description: `The reproduction steps, in order, at most ${REPORT_STEPS_MAX}. Pass an empty array to have the page reconstruct them from the recorded events instead of writing them yourself.`,
        items: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: `One action, e.g. "Open the province dropdown". At most ${REPORT_STEP_TEXT_MAX} characters.`,
            },
            atMs: {
              type: 'number',
              description:
                'When the recording shows this step happening, in milliseconds from the start, e.g. 28412. Give it whenever you know it: a step with no timestamp cannot be matched against the recorded events and is shown to the human as unverified.',
            },
          },
          required: ['text'],
          additionalProperties: false,
        },
      },
      expected: {
        type: 'string',
        description: 'What should have happened, e.g. "The dropdown lists the provinces for the selected country."',
      },
      actual: {
        type: 'string',
        description: 'What did happen, e.g. "The dropdown opened with no options and the Pay button stayed disabled."',
      },
      rootCause: {
        type: 'string',
        description: 'Your explanation of the cause, in one or two sentences, based on what you found in the recording.',
      },
      evidence: {
        type: 'array',
        description: `The moments that back the report, at most ${REPORT_EVIDENCE_MAX}. Each becomes a clickable timestamp in the report.`,
        items: {
          type: 'object',
          properties: {
            atMs: {
              type: 'number',
              description: 'When it happened, in milliseconds from the start of the recording, e.g. 28412.',
            },
            note: {
              type: 'string',
              description: 'What that moment shows, in a few words, e.g. "GET /provinces returned 500".',
            },
          },
          required: ['atMs'],
          additionalProperties: false,
        },
      },
      ticket: TICKET_FIELD,
    },
    required: ['title', 'steps', 'rootCause'],
    additionalProperties: false,
  },

  async execute(args) {
    const ticketArg = optionalString(args, 'ticket')
    if (!ticketArg.ok) return toolError(ticketArg.error)

    const waitingOn = 'the human to approve or edit the report draft'

    if (ticketArg.value !== null) {
      const collected = await collectRetry<ReportOutcome>('propose_report', ticketArg.value, waitingOn)
      if (collected.kind === 'response') return collected.response
      return settled(collected.value, [])
    }

    const state = sessionState()
    if (state.recording === null) return noRecording()

    const title = requireString(args, 'title')
    if (!title.ok) return toolError(title.error)

    const rootCause = requireString(args, 'rootCause')
    if (!rootCause.ok) return toolError(rootCause.error)

    const stepEntries = requireObjectArray(args, 'steps')
    if (!stepEntries.ok) return toolError(stepEntries.error)

    const read = readSteps(stepEntries.value)
    if (typeof read === 'string') return toolError(read)

    const evidence = readEvidence(args['evidence'])
    if (typeof evidence === 'string') return toolError(evidence)

    const summary = optionalString(args, 'summary')
    if (!summary.ok) return toolError(summary.error)
    const expected = optionalString(args, 'expected')
    if (!expected.ok) return toolError(expected.error)
    const actual = optionalString(args, 'actual')
    if (!actual.ok) return toolError(actual.error)

    if (openReview !== null) {
      return toolError(
        'A report draft is already waiting on the human. Retry that call with its ticket rather than ' +
          'proposing a second draft over the one they are reading.',
      )
    }

    /**
     * `verified: false` on the way in is a placeholder, not a claim: `buildReport` recomputes it for
     * every step against the recording's own event stream and never trusts the incoming value.
     */
    const proposed: Partial<Report> = {
      title: capText(title.value, REPORT_TITLE_MAX).text,
      summary: capText(summary.value ?? '', REPORT_PROSE_MAX).text,
      steps: read.steps.map((step): ReportStep => ({ ...step, verified: false })),
      expected: capText(expected.value ?? '', REPORT_PROSE_MAX).text,
      actual: capText(actual.value ?? '', REPORT_PROSE_MAX).text,
      rootCause: capText(rootCause.value, REPORT_PROSE_MAX).text,
      evidence: evidence.evidence,
    }

    let built: Report
    try {
      built = buildReport(state.recording, proposed)
    } catch {
      return toolError(
        'The report could not be reconstructed from this recording. Call read_session_meta to confirm what is ' +
          'loaded, then propose again.',
      )
    }

    sessionActions().setReport(built, 'agent')
    const stored = sessionState().report

    const gate = createGate<ReportOutcome>('report')
    let cancelWatch: (() => void) | null = null
    openReview = { ticket: gate.ticket, cancel: () => cancelWatch?.() }

    cancelWatch = watchForHuman<ReportOutcome>(
      (next: SessionState) => {
        // Untouched: the draft the agent just filed is still the one on screen.
        if (next.report === stored) return null
        if (next.report === null) return { kind: 'rejected' }
        if (next.report.author === 'human') {
          return { kind: 'approved', report: next.report, editedByHuman: true }
        }
        return { kind: 'superseded' }
      },
      (outcome) => {
        // Only this gate's slot: a newer review may have opened while this one was pending.
        if (openReview?.ticket === gate.ticket) openReview = null
        answerGate(gate.ticket, outcome)
      },
    )

    const result = await gate.promise
    if (result.status === 'answered') return settled(result.value, read.notes.concat(evidence.notes))

    // Watcher and `openReview` both left in place: the approval is very likely to land between two
    // polls, and the ticket is the only way back to this draft.
    return pendingResponse('propose_report', result.ticket, waitingOn)
  },
}

function settled(outcome: ReportOutcome, notes: readonly string[]): ToolResponse {
  if (outcome.kind === 'approved') return approvedResponse(outcome, notes)

  if (outcome.kind === 'superseded') {
    return toolError(
      'A newer report draft replaced the one you proposed, so there is nothing left to approve. Work from the ' +
        'draft that is on screen now rather than re-proposing yours.',
    )
  }

  return json({
    status: 'answered',
    approved: false,
    nextStep:
      'The human did not accept the draft. Do not re-send it unchanged: ask what is wrong with it, or go back ' +
      'to the recording and support the parts they doubted with bisect, read_dom_at or read_network.',
  })
}
