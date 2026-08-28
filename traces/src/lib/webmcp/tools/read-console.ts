import { buildEventDigest } from '@/lib/replay/event-digest'
import type { DigestEvent } from '@/types/domain'
import { type ToolDefinition, json } from '../tool-types'
import { currentRecording, optionalWindow, truncate } from './tool-context'

/**
 * 'read_console' — see docs/tools.md#7-read_console for the full contract.
 *
 * Wraps lib/replay/event-digest.
 *
 * Two budgets, both from CONTRIBUTING.md § Every tool response has a budget: 200 characters per
 * message and `CONSOLE_LIMIT` messages per call. A stack trace pasted into `console.error` is
 * routinely several kilobytes, so the per-message cap is the one that actually bites — and the first
 * 200 characters of a console error are where the useful part lives.
 *
 * Ordering: chronological, because reading console output is reconstructing a sequence. The *cap*,
 * though, drops warnings before errors — clipping the tail in time order would throw away the error at
 * the end of a noisy window, which is usually the reason the window was interesting.
 */

/** Response budget, matching `list_events` so the two tools do not teach different limits. */
const CONSOLE_LIMIT = 40
/**
 * Per-message budget, from CONTRIBUTING.md.
 *
 * A backstop rather than the operative limit today: `buildEventDigest` already truncates every summary
 * to 120 characters, so this cap is unreachable through the current digest. It is applied anyway,
 * because "messages are capped at 200 characters" is this tool's promise to the agent and it should not
 * be a fact about somebody else's constant — if the digest's own limit is ever raised, the promise here
 * still holds.
 */
const MESSAGE_CHARS = 200

type ConsoleEntry = { atMs: number; level: 'error' | 'warn'; message: string }

function toEntry(event: DigestEvent): ConsoleEntry {
  return {
    atMs: event.atMs,
    level: event.kind === 'consoleError' ? 'error' : 'warn',
    message: truncate(event.summary, MESSAGE_CHARS),
  }
}

export const readConsoleTool: ToolDefinition = {
  name: 'read_console',
  description: [
    'Read the console errors and warnings the recorded page logged inside a time window, in',
    'chronological order, each message truncated to 200 characters. Use it to find the exception behind',
    'a visible failure, and to get the timestamp to hand to bisect or read_dom_at. Only error- and',
    'warning-level output is captured, so an empty result means no errors or warnings were logged — not',
    'that the page logged nothing at all.',
  ].join(' '),

  // Console messages are whatever the recorded page chose to log, verbatim.
  annotations: { readOnlyHint: true, untrustedContentHint: true },

  inputSchema: {
    type: 'object',
    properties: {
      from: {
        type: 'number',
        description:
          'Start of the window, in ms from the start of the recording. Defaults to 0. Example: pass 27000 and to: 30000 to read around a failure you located at 28412 ms.',
      },
      to: {
        type: 'number',
        description:
          'End of the window, in ms from the start of the recording. Defaults to the end of the recording (durationMs from read_session_meta).',
      },
    },
    additionalProperties: false,
  },

  async execute(args) {
    const recording = currentRecording()
    if (!recording.ok) return recording.response

    const window = optionalWindow(args, recording.value)
    if (!window.ok) return window.response

    // Unbounded, so `totalMatched` below is the real count rather than the cap. See list-events.ts.
    const matched = buildEventDigest(recording.value, {
      fromMs: window.value.fromMs,
      toMs: window.value.toMs,
      kinds: ['consoleError', 'consoleWarn'],
      limit: Number.MAX_SAFE_INTEGER,
    }).events

    const truncated = matched.length > CONSOLE_LIMIT
    const kept = truncated
      ? // Rank errors above warnings to decide *what* survives, then restore time order to decide how it
        // reads. Array#sort is stable, so equal ranks keep their chronological positions.
        [...matched]
          .sort((left, right) => Number(right.kind === 'consoleError') - Number(left.kind === 'consoleError'))
          .slice(0, CONSOLE_LIMIT)
          .sort((left, right) => left.atMs - right.atMs)
      : matched

    const errorCount = matched.filter((event) => event.kind === 'consoleError').length

    return json({
      fromMs: window.value.fromMs,
      toMs: window.value.toMs,
      entries: kept.map(toEntry),
      totalMatched: matched.length,
      errorCount,
      warnCount: matched.length - errorCount,
      truncated,
      ...(truncated
        ? {
            note:
              `${matched.length} messages matched and ${CONSOLE_LIMIT} are shown, errors kept ahead of warnings. ` +
              'Narrow the window around the moment you care about — a few seconds either side of a failed ' +
              'request or a rage-click is usually enough.',
          }
        : {}),
    })
  },
}
