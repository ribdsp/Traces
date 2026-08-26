import { type ToolDefinition, notImplemented } from '../tool-types'

/**
 * `ask_human_visual` — the agent declares it cannot see, and recruits the human as its sensor.
 *
 * Owner: Vicko. Contract: docs/tools.md#12-ask_human_visual.
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
   * TODO(vicko), Day 4:
   *   - reject fewer than two or more than four choices, and choices over ~40 characters
   *   - with a `ticket`, attach to the existing gate via retryGate — never open a second question
   *   - otherwise: openAsk in the store, seek the player to hintAtMs, createGate('ask')
   *   - resolve to { status: 'answered', choice, markedTimestamp } or { status: 'pending', ticket }
   *   - on answer, drop a marker authored by the human at markedTimestamp: their answer becomes
   *     evidence on the timeline, not just a sentence in the transcript
   */
  async execute() {
    return notImplemented('ask_human_visual')
  },
}
