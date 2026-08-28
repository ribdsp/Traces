import type { AskHumanVisualAnswer, SessionState } from '@/types/domain'
import { getActiveEngine } from '@/lib/replay/replay-engine'
import { consumeAskAnswer, sessionActions, sessionState } from '@/lib/store/session'
import { type ToolDefinition, type ToolResponse, json, noRecording, requireString, toolError } from '../tool-types'
import { answerGate, createGate } from '../blocking'
import {
  MARKER_LABEL_MAX,
  capText,
  clampToRecording,
  collectRetry,
  optionalNumber,
  optionalString,
  pendingResponse,
  watchForHuman,
} from './tool-support'

/**
 * `ask_human_visual` — the agent declares it cannot see, and recruits the human as its sensor.
 *
 * Contract: docs/tools.md#12-ask_human_visual.
 *
 * The direction of information here is the inverse of the usual story. Normally the agent wants to
 * see the screen: it takes a screenshot and guesses. Here it states plainly that it cannot see
 * rendered output, and asks a person to look — and the answer comes back as structured data, a choice
 * plus the exact timestamp the human clicked on the player, rather than as prose it then has to
 * interpret.
 *
 * This tool exists because of a real limitation of the current spec — `content` supports `"text"` and
 * an `"image"` type is still an open question — and it turned out better than the screenshot version
 * would have been. A screenshot costs thousands of tokens and still leaves the model guessing about
 * state it cannot read off pixels. A human costs one click and answers the question exactly.
 *
 * The description below has to say *out loud* that the agent cannot see. Without that sentence,
 * models reach for this tool as a general-purpose escape from any uncertainty, and a demo where the
 * agent asks a human four questions it could have answered itself is a worse demo, not a more
 * collaborative one.
 */
/**
 * Two to four choices, and each one short.
 *
 * Both halves are about the human, not about tokens. Fewer than two is not a question, it is a
 * confirmation dialog; more than four is a form. And a choice longer than ASK_CHOICE_MAX does not fit
 * on a button over the player, so it is read half-truncated and answered wrongly — the one failure
 * mode of this tool that produces *bad data* rather than no data.
 */
export const ASK_CHOICES_MIN = 2
export const ASK_CHOICES_MAX = 4
export const ASK_CHOICE_MAX = 40

/** The question sits in a narrow panel next to the replay. Past this it stops being read. */
export const ASK_QUESTION_MAX = 300

export type ChoiceCheck = { ok: true; choices: string[] } | { ok: false; error: string }

/**
 * Validate the choice list, with the recovery in every message.
 *
 * Duplicates are rejected rather than de-duplicated because `MarkPointOverlay` keys its buttons by the
 * choice text: two identical choices are two buttons React cannot tell apart, and a human clicking the
 * second one is not obviously answering the same thing the agent thinks they are.
 */
export function validateChoices(value: unknown): ChoiceCheck {
  if (!Array.isArray(value)) {
    return { ok: false, error: `'choices' is required and must be an array of ${ASK_CHOICES_MIN} to ${ASK_CHOICES_MAX} short strings.` }
  }

  if (value.length < ASK_CHOICES_MIN || value.length > ASK_CHOICES_MAX) {
    return {
      ok: false,
      error:
        `'choices' must hold ${ASK_CHOICES_MIN} to ${ASK_CHOICES_MAX} options, not ${value.length}. One option is a ` +
        'confirmation, more than four is a form — offer the distinct answers you actually need to tell apart.',
    }
  }

  const choices: string[] = []
  const seen = new Set<string>()
  // `Array.isArray` narrows to `any[]`; re-bound as `unknown[]` so every entry is still checked.
  const entries: unknown[] = value

  for (const [index, raw] of entries.entries()) {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return { ok: false, error: `'choices[${index}]' must be a non-empty string.` }
    }

    const choice = raw.trim()
    if (choice.length > ASK_CHOICE_MAX) {
      return {
        ok: false,
        error:
          `'choices[${index}]' is ${choice.length} characters; keep every choice under ${ASK_CHOICE_MAX} so it fits ` +
          'on a button over the player. Put the detail in the question and keep the choices to a few words.',
      }
    }

    const key = choice.toLowerCase()
    if (seen.has(key)) {
      return {
        ok: false,
        error: `'choices' repeats "${choice}". Every option must be distinct, or the human cannot tell them apart.`,
      }
    }
    seen.add(key)
    choices.push(choice)
  }

  return { ok: true, choices }
}

/**
 * What the human did with the question.
 *
 * A dismissal is a real outcome and has to be one, or the gate waits on an answer that can never
 * arrive: `clearAsk` closes the slot without writing an answer (lib/store/session.ts), and the overlay
 * offers exactly that.
 */
type AskOutcome =
  | { kind: 'answered'; answer: AskHumanVisualAnswer; markerId: string | null }
  | { kind: 'dismissed' }

/**
 * The questions this tool has open, `askId` → gate ticket.
 *
 * Needed because of one specific mistake a model makes: asking again, without its ticket, while the
 * first question is still on screen. `openAsk` refuses to overwrite an open question and hands back the
 * *existing* one's id, so without this map the tool would think it had opened a question the human will
 * never see. With it, the second call reattaches to the first question's gate — which is the same rule
 * as the ticket path, applied to an agent that forgot its ticket.
 */
const openAsks = new Map<string, string>()

/** Where the human is asked to look. Best effort: a question is worth asking even if the player isn't up. */
async function pointAt(atMs: number): Promise<void> {
  sessionActions().setCurrentTime(atMs, 'agent')
  try {
    await getActiveEngine()?.gotoTime(atMs)
  } catch {
    // The player is mid-load. The playhead in the store has already moved, which is what the UI draws.
  }
}

function answeredResponse(outcome: Extract<AskOutcome, { kind: 'answered' }>): ToolResponse {
  const { answer, markerId } = outcome
  return json({
    status: 'answered',
    choice: answer.choice,
    markedTimestamp: answer.markedTimestamp,
    ...(answer.note === undefined ? {} : { note: capText(answer.note, 200).text }),
    ...(markerId === null ? {} : { markerId }),
    nextStep:
      'The timestamp they marked is a fact, not an opinion — work from it. read_dom_at or bisect around ' +
      'markedTimestamp rather than asking a second question about the same moment.',
  })
}

export const askHumanVisualTool: ToolDefinition = {
  name: 'ask_human_visual',
  description: [
    'Ask the human to look at the replay and answer a question you cannot answer yourself.',
    'You cannot see rendered output: you have no screenshots and no pixels, only the compressed DOM',
    'from read_dom_at. Use this only for questions that genuinely require eyes — whether something',
    'looked visibly broken, whether an element was covered, whether the user appeared confused —',
    'and not for anything you could establish with read_dom_at, bisect, or measure_layout.',
    'The human answers by clicking a moment on the player, so you get back their choice and the exact',
    'timestamp they marked. This call blocks until they respond; if they are slow you receive a',
    'ticket and should call again with it rather than starting a new question.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description:
          'What you need a person to look at. State what you already know and what you cannot determine, e.g. "The province dropdown has zero options from 28.4s. I cannot tell whether it looked visibly broken or just empty."',
      },
      choices: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Two to four short answers to choose from. Concrete options get answered in seconds; open questions get skipped.',
      },
      hintAtMs: {
        type: 'number',
        description: 'Where you suggest they look, in ms. The player seeks here. They may mark elsewhere.',
      },
      ticket: {
        type: 'string',
        description: 'Only when retrying a call that previously returned status "pending". Do not invent one.',
      },
    },
    required: ['question', 'choices'],
    additionalProperties: false,
  },

  /**
   * What shipped, and why:
   *   - `choices` validated to 2..4 distinct options, each under ASK_CHOICE_MAX (see `validateChoices`)
   *   - with a `ticket`, `retryGate` reattaches to the same question; a second gate is never opened
   *   - otherwise `openAsk`, seek to `hintAtMs`, `createGate('ask')`
   *   - the human's click lands in the store, and `consumeAskAnswer` is the seam that turns it into the
   *     gate's answer — the store cannot call `answerGate` itself without an import cycle
   *   - on answer, a marker authored by **the human** is dropped at `markedTimestamp`, so their answer
   *     becomes evidence on the timeline rather than a sentence in a transcript
   *   - a dismissal resolves too, as a readable error. A question closed without an answer would
   *     otherwise leave the agent polling a ticket nothing will ever answer.
   */
  async execute(args) {
    const ticketArg = optionalString(args, 'ticket')
    if (!ticketArg.ok) return toolError(ticketArg.error)

    const waitingOn = 'the human to look at the replay and answer'

    if (ticketArg.value !== null) {
      const collected = await collectRetry<AskOutcome>('ask_human_visual', ticketArg.value, waitingOn)
      if (collected.kind === 'response') return collected.response
      return collected.value.kind === 'answered' ? answeredResponse(collected.value) : dismissedError()
    }

    const state = sessionState()
    if (state.recording === null) return noRecording()

    const question = requireString(args, 'question')
    if (!question.ok) return toolError(question.error)
    if (question.value.trim().length > ASK_QUESTION_MAX) {
      return toolError(
        `'question' is ${question.value.trim().length} characters; keep it under ${ASK_QUESTION_MAX}. Say what you ` +
          'know and what you cannot determine, in two sentences — the human reads this next to the replay.',
      )
    }

    const choices = validateChoices(args['choices'])
    if (!choices.ok) return toolError(choices.error)

    const hint = optionalNumber(args, 'hintAtMs')
    if (!hint.ok) return toolError(hint.error)
    const hintAtMs =
      hint.value === null ? null : clampToRecording(hint.value, state.recording.durationMs).atMs

    // One question at a time, because the human can only be looking at one thing.
    const alreadyOpen = state.pendingAsk
    if (alreadyOpen !== null) {
      const openTicket = openAsks.get(alreadyOpen.id)
      if (openTicket === undefined) {
        return toolError(
          `A question is already on the human's screen: "${capText(alreadyOpen.question, 120).text}". Wait for ` +
            'them to answer that one before asking another.',
        )
      }

      const collected = await collectRetry<AskOutcome>('ask_human_visual', openTicket, waitingOn)
      if (collected.kind === 'response') return collected.response
      return collected.value.kind === 'answered' ? answeredResponse(collected.value) : dismissedError()
    }

    const askId = sessionActions().openAsk({
      question: capText(question.value, ASK_QUESTION_MAX).text,
      choices: choices.choices,
      ...(hintAtMs === null ? {} : { hintAtMs }),
    })

    const gate = createGate<AskOutcome>('ask')
    openAsks.set(askId, gate.ticket)

    /**
     * Read the human's action out of the store, or null while the question is still open.
     *
     * Named rather than inlined because it has to run twice: once per store change, and once
     * immediately below. Seeking to `hintAtMs` awaits the replay engine, and a fast human could answer
     * during that await — before the subscription exists. `consumeAskAnswer` is read-once, so an answer
     * missed there is gone, and the symptom would be an agent politely polling a ticket forever.
     */
    const collect = (next: SessionState): AskOutcome | null => {
      // Still on screen: nothing has happened yet.
      if (next.pendingAsk !== null && next.pendingAsk.id === askId) return null

      const answer = consumeAskAnswer(askId)
      if (answer === null) return { kind: 'dismissed' }

      const marked = clampToRecording(answer.markedTimestamp, next.recording?.durationMs ?? answer.markedTimestamp)
      const label = capText(`"${answer.choice}" — ${question.value}`, MARKER_LABEL_MAX)

      // Authored by the human: they are the one who saw it. This is the whole point of the tool —
      // the answer lands on the timeline as evidence anyone can click, not as prose in a transcript.
      const markerId = sessionActions().addMarker({
        timestamp: marked.atMs,
        label: label.text,
        severity: 'info',
        author: 'human',
      })

      return { kind: 'answered', answer: { ...answer, markedTimestamp: marked.atMs }, markerId }
    }

    const deliver = (outcome: AskOutcome): void => {
      openAsks.delete(askId)
      answerGate(gate.ticket, outcome)
    }

    const cancel = watchForHuman<AskOutcome>(collect, deliver)

    if (hintAtMs !== null) {
      await pointAt(hintAtMs)

      // Anything that landed while the engine was seeking.
      const missed = collect(sessionState())
      if (missed !== null) {
        cancel()
        deliver(missed)
      }
    }

    const result = await gate.promise
    if (result.status === 'answered') {
      return result.value.kind === 'answered' ? answeredResponse(result.value) : dismissedError()
    }

    // The watcher is left running on purpose: the human usually answers between two polls, and the
    // answer is parked on the ticket for whichever retry comes next.
    return pendingResponse('ask_human_visual', result.ticket, waitingOn)
  },
}

/** A closed question with no answer. Not a failure of the tool, but not something to retry either. */
function dismissedError(): ToolResponse {
  return toolError(
    'The human closed the question without answering it. Do not ask the same thing again — carry on with ' +
      'what you can establish yourself using read_dom_at, measure_layout or bisect, and say in your answer ' +
      'which part you could not confirm.',
  )
}
