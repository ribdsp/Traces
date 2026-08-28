import type { Hypothesis, SessionState } from '@/types/domain'
import { sessionActions, sessionState } from '@/lib/store/session'
import { type ToolDefinition, type ToolResponse, json, noRecording, toolError } from '../tool-types'
import { answerGate, createGate } from '../blocking'
import {
  TICKET_FIELD,
  capList,
  capText,
  collectRetry,
  optionalString,
  requireObjectArray,
  watchForHuman,
} from './tool-support'

/**
 * 'propose_hypotheses' — see docs/tools.md for the full contract.
 *
 * What shipped, and why:
 *   - `HYPOTHESES_MIN`..`HYPOTHESES_MAX` cards, each with at least one piece of evidence the recording
 *     actually covers. A hypothesis with no evidence is rejected, and that rule is the tool: clicking a
 *     card is supposed to highlight everything supporting it at once, and a card with nothing behind it
 *     is an assertion with a percentage attached.
 *   - confidences normalised on the page when they do not sum to 1 (`normaliseConfidences`)
 *   - `addHypotheses` with `author: 'agent'`, then `createGate('hypotheses')` and a watcher on the
 *     human's promote/reject
 *   - with a `ticket`, `retryGate` reattaches to the same set — a second call never re-proposes
 *
 * **Doc drift:** docs/tools.md §13 documents evidence entries as `{ timestampMs, kind, note }`. The
 * frozen contract in types/domain.ts is `{ markerId?, atMs, note }` and has no `kind`, so the schema
 * below follows the type. §13 is the side that needs correcting.
 */

/** Two is the minimum for a *ranked* set; five is what the UI can show without becoming a list to skim. */
export const HYPOTHESES_MIN = 2
export const HYPOTHESES_MAX = 5

/** One card, a couple of lines. The reasoning belongs in `propose_report`, not on a card. */
export const HYPOTHESIS_TEXT_MAX = 240

/** Evidence chips sit in a row under the card, and a row that wraps three times stops being scannable. */
export const EVIDENCE_PER_HYPOTHESIS_MAX = 5
export const EVIDENCE_NOTE_MAX = 120

/**
 * Rescale claimed confidences so the set sums to 1.
 *
 * Done on the page, per §13, because a model asked for confidences produces four numbers that each look
 * reasonable and sum to 2.4 — and the cards are drawn as bars relative to each other, so unnormalised
 * inputs render a set where every hypothesis looks near-certain.
 *
 * Non-finite and negative claims count as 0 rather than rejecting the whole call; if that leaves nothing
 * to scale, the set is split evenly, which is the honest reading of "no usable claim". Rounding is to
 * three places and is for display only — `Hypothesis.confidence` is documented as displayed, never used
 * for arithmetic — so a set of three may sum to 0.999 rather than exactly 1.
 */
export function normaliseConfidences(values: readonly number[]): number[] {
  if (values.length === 0) return []

  const round = (value: number): number => Math.round(value * 1_000) / 1_000
  const usable = values.map((value) => (Number.isFinite(value) && value > 0 ? value : 0))
  const total = usable.reduce((sum, value) => sum + value, 0)

  if (total === 0) return usable.map(() => round(1 / usable.length))
  return usable.map((value) => round(value / total))
}

type ProposedEvidence = { markerId?: string; atMs: number; note: string }
type ProposedHypothesis = { text: string; confidence: number; evidence: ProposedEvidence[] }

export type HypothesesCheck =
  | { ok: true; hypotheses: ProposedHypothesis[]; notes: string[] }
  | { ok: false; error: string }

/**
 * Validate the whole proposal, with the fix in every message.
 *
 * `durationMs` and `markerIds` come from the session rather than the arguments: an evidence timestamp
 * past the end of the recording, or a marker id that does not exist, both produce a card whose chips
 * highlight nothing when clicked — which looks like a broken UI rather than a bad argument.
 */
export function validateHypotheses(
  entries: readonly Record<string, unknown>[],
  durationMs: number,
  markerIds: ReadonlySet<string>,
): HypothesesCheck {
  if (entries.length < HYPOTHESES_MIN || entries.length > HYPOTHESES_MAX) {
    return {
      ok: false,
      error:
        `'hypotheses' must hold ${HYPOTHESES_MIN} to ${HYPOTHESES_MAX} entries, not ${entries.length}. One ` +
        'explanation is a conclusion, not a ranked set — give the human the alternatives you actually ' +
        'weighed, best first.',
    }
  }

  const notes: string[] = []
  const hypotheses: ProposedHypothesis[] = []

  for (const [index, entry] of entries.entries()) {
    const position = index + 1
    const rawText = entry['text']
    if (typeof rawText !== 'string' || rawText.trim().length === 0) {
      return { ok: false, error: `'hypotheses[${index}].text' is required and must be a non-empty string.` }
    }
    if (rawText.trim().length > HYPOTHESIS_TEXT_MAX) {
      return {
        ok: false,
        error:
          `'hypotheses[${index}].text' is ${rawText.trim().length} characters; keep each one under ` +
          `${HYPOTHESIS_TEXT_MAX}. State the explanation in a sentence and put the supporting detail in its ` +
          'evidence notes.',
      }
    }

    const confidence = entry['confidence']
    if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
      return {
        ok: false,
        error:
          `'hypotheses[${index}].confidence' is required and must be a number between 0 and 1, e.g. 0.6. The ` +
          'page rescales the set so it sums to 1.',
      }
    }

    const rawEvidence = entry['evidence']
    if (!Array.isArray(rawEvidence) || rawEvidence.length === 0) {
      return {
        ok: false,
        error:
          `Hypothesis ${position} has no evidence. Every hypothesis needs at least one moment from the ` +
          'recording, because clicking a card highlights its evidence on the timeline — a card with none is ' +
          'an assertion with a percentage on it. Use the timestamps you got from list_events, bisect or ' +
          'annotate.',
      }
    }

    const bounded = capList(rawEvidence as unknown[], EVIDENCE_PER_HYPOTHESIS_MAX)
    if (bounded.truncated) {
      notes.push(
        `Hypothesis ${position} cited ${rawEvidence.length} moments; cite at most ${EVIDENCE_PER_HYPOTHESIS_MAX} of ` +
          'the strongest ones per hypothesis.',
      )
    }

    const evidence: ProposedEvidence[] = []
    for (const [evidenceIndex, item] of bounded.items.entries()) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        return {
          ok: false,
          error: `'hypotheses[${index}].evidence[${evidenceIndex}]' must be an object like { "atMs": 28412, "note": "province dropdown empty" }.`,
        }
      }

      const record = item as Record<string, unknown>
      const atMs = record['atMs']
      if (typeof atMs !== 'number' || !Number.isFinite(atMs)) {
        return {
          ok: false,
          error: `'hypotheses[${index}].evidence[${evidenceIndex}].atMs' is required and must be a time in milliseconds from the start of the recording, e.g. 28412.`,
        }
      }
      if (atMs < 0 || atMs > durationMs) {
        return {
          ok: false,
          error:
            `'hypotheses[${index}].evidence[${evidenceIndex}].atMs' is ${Math.round(atMs)}ms, outside this ` +
            `${durationMs}ms recording. Cite a moment the recording covers, or the chip highlights nothing when ` +
            'the human clicks it.',
        }
      }

      const rawNote = record['note']
      if (rawNote !== undefined && typeof rawNote !== 'string') {
        return { ok: false, error: `'hypotheses[${index}].evidence[${evidenceIndex}].note', when given, must be a string.` }
      }

      const markerId = record['markerId']
      if (markerId !== undefined) {
        if (typeof markerId !== 'string' || !markerIds.has(markerId)) {
          return {
            ok: false,
            error:
              `'hypotheses[${index}].evidence[${evidenceIndex}].markerId' is not a marker on this timeline. Omit ` +
              'it, or pass back an id that annotate returned to you.',
          }
        }
      }

      const note = capText(typeof rawNote === 'string' ? rawNote : '', EVIDENCE_NOTE_MAX)
      evidence.push({
        atMs: Math.round(atMs),
        note: note.text,
        ...(typeof markerId === 'string' ? { markerId } : {}),
      })
    }

    hypotheses.push({ text: capText(rawText, HYPOTHESIS_TEXT_MAX).text, confidence, evidence })
  }

  return { ok: true, hypotheses, notes }
}

type Card = { id: string; index: number; text: string }

type HypothesesOutcome =
  | { kind: 'decided'; promoted: Card[]; rejected: Card[] }
  /** The human undid the whole set, or the session was reset under it. */
  | { kind: 'withdrawn' }

/**
 * When the human has said enough for the agent to carry on.
 *
 * Not "every card decided": people promote the one they believe and leave the rest alone, and a rule
 * that waits for all of them would keep an agent polling a set the human considers finished. So one
 * promotion settles it, and so does every card having been rejected — the two states that actually
 * change what the agent should do next.
 */
function decide(state: SessionState, ids: readonly string[]): HypothesesOutcome | null {
  const present = ids
    .map((id, index) => {
      const found = state.hypotheses.find((candidate) => candidate.id === id)
      return found === undefined ? null : { hypothesis: found, index }
    })
    .filter((entry): entry is { hypothesis: Hypothesis; index: number } => entry !== null)

  if (present.length === 0) return { kind: 'withdrawn' }

  const card = (entry: { hypothesis: Hypothesis; index: number }): Card => ({
    id: entry.hypothesis.id,
    index: entry.index + 1,
    text: entry.hypothesis.text,
  })

  const promoted = present.filter((entry) => entry.hypothesis.status === 'promoted').map(card)
  const rejected = present.filter((entry) => entry.hypothesis.status === 'rejected').map(card)

  if (promoted.length === 0 && rejected.length < present.length) return null
  return { kind: 'decided', promoted, rejected }
}

function decidedResponse(
  outcome: Extract<HypothesesOutcome, { kind: 'decided' }>,
  extra: Record<string, unknown> = {},
): ToolResponse {
  const { promoted, rejected } = outcome
  return json({
    status: 'answered',
    promoted: promoted.map((entry) => entry.id),
    rejected: rejected.map((entry) => entry.id),
    decided: [
      ...promoted.map((entry) => ({ index: entry.index, text: entry.text, status: 'promoted' })),
      ...rejected.map((entry) => ({ index: entry.index, text: entry.text, status: 'rejected' })),
    ],
    ...extra,
    nextStep:
      promoted.length > 0
        ? 'Work the promoted hypothesis: confirm it with bisect or read_dom_at, then call propose_report. ' +
          'Drop the rejected ones rather than arguing for them.'
        : 'Everything you proposed was rejected. Go back to the evidence with list_events, read_console or ' +
          'bisect before proposing again — do not re-send the same set.',
  })
}

export const proposeHypothesesTool: ToolDefinition = {
  name: 'propose_hypotheses',
  description: "Propose two to five ranked explanations, each with the timestamps that support it, then wait for the human to promote or reject them. This call blocks until they decide.",

  inputSchema: {
    type: 'object',
    properties: {
      hypotheses: {
        type: 'array',
        description: `Your ranked explanations, best first: ${HYPOTHESES_MIN} to ${HYPOTHESES_MAX} of them. The page rescales the confidences so they sum to 1.`,
        items: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: `The explanation in one sentence, e.g. "The province list is fetched after the form renders and the request fails, so the select stays empty." At most ${HYPOTHESIS_TEXT_MAX} characters.`,
            },
            confidence: {
              type: 'number',
              description: 'How strongly you believe it, 0 to 1, e.g. 0.6. Rescaled with the others; shown as a bar, never as a percentage.',
              minimum: 0,
              maximum: 1,
            },
            evidence: {
              type: 'array',
              description: `The moments that support it — at least one, at most ${EVIDENCE_PER_HYPOTHESIS_MAX}. Clicking the card highlights all of them on the timeline, so a hypothesis with no evidence is rejected.`,
              items: {
                type: 'object',
                properties: {
                  atMs: {
                    type: 'number',
                    description: 'When it happened, in milliseconds from the start of the recording, e.g. 28412. Must be inside the recording.',
                  },
                  note: {
                    type: 'string',
                    description: `What that moment shows, in a few words, e.g. "GET /provinces returned 500". At most ${EVIDENCE_NOTE_MAX} characters.`,
                  },
                  markerId: {
                    type: 'string',
                    description: 'Optional. The id annotate returned, if this evidence is a marker you already put on the timeline. Do not invent one.',
                  },
                },
                required: ['atMs'],
                additionalProperties: false,
              },
            },
          },
          required: ['text', 'confidence', 'evidence'],
          additionalProperties: false,
        },
      },
      ticket: TICKET_FIELD,
    },
    required: ['hypotheses'],
    additionalProperties: false,
  },

  async execute(args) {
    const ticketArg = optionalString(args, 'ticket')
    if (!ticketArg.ok) return toolError(ticketArg.error)

    const waitingOn = 'the human to promote or reject a hypothesis'

    if (ticketArg.value !== null) {
      const collected = await collectRetry<HypothesesOutcome>('propose_hypotheses', ticketArg.value, waitingOn)
      if (collected.kind === 'response') return collected.response
      return collected.value.kind === 'decided' ? decidedResponse(collected.value) : withdrawnError()
    }

    const state = sessionState()
    if (state.recording === null) return noRecording()

    const entries = requireObjectArray(args, 'hypotheses')
    if (!entries.ok) return toolError(entries.error)

    const markerIds = new Set(state.markers.map((marker) => marker.id))
    const checked = validateHypotheses(entries.value, state.recording.durationMs, markerIds)
    if (!checked.ok) return toolError(checked.error)

    const confidences = normaliseConfidences(checked.hypotheses.map((hypothesis) => hypothesis.confidence))

    const ids = sessionActions().addHypotheses(
      checked.hypotheses.map((hypothesis, index) => ({
        text: hypothesis.text,
        confidence: confidences[index] ?? 0,
        evidence: hypothesis.evidence,
        status: 'proposed' as const,
        author: 'agent' as const,
      })),
    )

    if (ids.length === 0) {
      return toolError('The hypotheses could not be added to the session. Call read_session_meta and try again.')
    }

    const gate = createGate<HypothesesOutcome>('hypotheses')
    watchForHuman<HypothesesOutcome>(
      (next) => decide(next, ids),
      (outcome) => {
        answerGate(gate.ticket, outcome)
      },
    )

    const result = await gate.promise
    const budget =
      checked.notes.length > 0 ? { truncated: true, budgetNotes: checked.notes } : {}

    if (result.status === 'answered') {
      return result.value.kind === 'decided'
        ? decidedResponse(result.value, budget)
        : withdrawnError()
    }

    // Watcher left running: the human very often decides between two polls, and the answer is parked
    // on the ticket until the retry collects it. The payload mirrors `pendingResponse` and adds what is
    // only knowable on this call — how the confidences were rescaled, and anything the budget clipped.
    return json({
      status: 'pending',
      ticket: result.ticket,
      waitingOn,
      proposed: ids.length,
      normalisedConfidences: confidences,
      ...budget,
      nextStep:
        `The cards are on the human's screen. Call propose_hypotheses again with ticket "${result.ticket}" to ` +
        'reattach to this same set — calling without the ticket would propose them a second time. Leave a few ' +
        'seconds between retries and tell the user you are waiting on their judgement.',
    })
  },
}

function withdrawnError(): ToolResponse {
  return toolError(
    'The human removed your hypotheses instead of deciding on them, so there is nothing to collect. Do not ' +
      're-send the same set: go back to the recording with list_events, read_console or bisect and propose ' +
      'from what you find there.',
  )
}
