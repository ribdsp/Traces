import { getActiveEngine } from '@/lib/replay/replay-engine'
import { sessionActions, sessionState } from '@/lib/store/session'
import { type ToolDefinition, json, noRecording, requireNumber, toolError } from '../tool-types'
import { clampToRecording, optionalNumber } from './tool-support'

/**
 * 'seek' — see docs/tools.md for the full contract.
 *
 * The only tool whose effect is purely on human attention. Nothing is retrieved: the agent is pointing
 * at evidence and saying *look here*, which is why it writes to both the replay engine and the store.
 * The engine moves the pixels; the store moves the playhead the UI renders and is what makes an
 * agent-driven seek visible at all (see the note in components/player/player-controls.tsx).
 *
 * What shipped, and why:
 *   - `setCurrentTime(atMs, 'agent')` plus `engine.gotoTime`, and the response reports the position
 *     actually reached rather than the one that was asked for
 *   - `getActiveEngine()` is null until ReplayStage mounts, which is a readable "not ready, retry",
 *     never a stack trace
 *   - `play` is bounded playback: PLAY_MAX_MS at most, awaited, so nothing is still moving the
 *     playhead once the call returns and the next read_dom_at is not fighting a ticker
 */

/**
 * The longest stretch `play` will actually play for.
 *
 * The budget on this tool is time, not text — the response is three fields. A model that asks to play
 * 30 seconds of a recording is asking the tool call to hang for 30 seconds, which every host tolerates
 * differently and no agent recovers from gracefully. 5s is long enough to watch a dropdown fail and
 * short enough to be nowhere near the blocking tools' timeout.
 */
export const PLAY_MAX_MS = 5_000

/** How often the playhead advances while playing. 10fps is enough to read as motion, cheap to drive. */
const PLAY_TICK_MS = 100

const sleep = (ms: number): Promise<void> =>
  // A function, never a string: see CONTRIBUTING.md § "Nothing from the model is ever executed".
  new Promise((resolve) => setTimeout(resolve, ms))

export const seekTool: ToolDefinition = {
  name: 'seek',
  description: "Move the human's playhead to a moment in the recording so they are looking at what you are talking about. Call this before asking them a question.",

  inputSchema: {
    type: 'object',
    properties: {
      timestamp: {
        type: 'number',
        description:
          'Where to put the playhead, in milliseconds from the start of the recording, e.g. 28412 for 28.412s. Clamped into the recording if it is past the end.',
      },
      play: {
        type: 'number',
        description: `How long to play for from that point, in milliseconds, e.g. 1500 to play a second and a half. Omit to park the playhead without playing. Capped at ${PLAY_MAX_MS}; this call does not return until playback stops.`,
        minimum: 0,
        maximum: PLAY_MAX_MS,
      },
    },
    required: ['timestamp'],
    additionalProperties: false,
  },

  async execute(args) {
    const { recording } = sessionState()
    if (recording === null) return noRecording()

    const timestamp = requireNumber(args, 'timestamp')
    if (!timestamp.ok) return toolError(timestamp.error)

    const play = optionalNumber(args, 'play')
    if (!play.ok) return toolError(play.error)
    if (play.value !== null && play.value < 0) {
      return toolError("'play' is a duration in milliseconds and cannot be negative. Omit it to park the playhead.")
    }

    const engine = getActiveEngine()
    if (engine === null) {
      return toolError(
        'The replay player has not mounted yet, so there is no playhead to move. Ask the human to load a ' +
          'recording, then call read_session_meta and try again.',
      )
    }

    const start = clampToRecording(timestamp.value, recording.durationMs)
    const requestedPlayMs = play.value ?? 0
    const playMs = Math.min(requestedPlayMs, PLAY_MAX_MS)
    const end = clampToRecording(start.atMs + playMs, recording.durationMs)

    try {
      // Store first: it is what the UI draws, so the playhead moves even if the engine is mid-seek.
      sessionActions().setCurrentTime(start.atMs, 'agent')
      await engine.gotoTime(start.atMs)

      if (end.atMs > start.atMs) {
        // Stepped rather than handed to a Replayer play(): the store is the single source of the
        // playhead, and repeated agent seeks coalesce into one activity-feed line by design.
        for (let at = start.atMs + PLAY_TICK_MS; at < end.atMs; at += PLAY_TICK_MS) {
          await sleep(PLAY_TICK_MS)
          sessionActions().setCurrentTime(at, 'agent')
          await engine.gotoTime(at)
        }
        sessionActions().setCurrentTime(end.atMs, 'agent')
        await engine.gotoTime(end.atMs)
      }
    } catch {
      return toolError(
        `The replay engine could not seek to ${start.atMs}ms. The player may still be loading — call ` +
          'read_session_meta to confirm a recording is loaded, then try again.',
      )
    }

    const notes: string[] = []
    if (start.clamped) {
      notes.push(
        `Use a timestamp between 0 and ${recording.durationMs} next time; ${Math.round(timestamp.value)} is outside the recording and was clamped.`,
      )
    }
    if (requestedPlayMs > PLAY_MAX_MS) {
      notes.push(
        `Ask for at most ${PLAY_MAX_MS}ms of playback per call; call seek again from ${end.atMs} to continue.`,
      )
    }

    return json({
      ok: true,
      at: end.atMs,
      playedMs: end.atMs - start.atMs,
      ...(notes.length > 0 ? { truncated: true, nextStep: notes.join(' ') } : {}),
    })
  },
}
