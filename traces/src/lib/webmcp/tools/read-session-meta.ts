import { type ToolDefinition, notImplemented } from '../tool-types'

/**
 * 'read_session_meta' — see docs/tools.md for the full contract.
 *
 * Owner: Vicko.
 *
 * TODO(vicko), Day 3:
 *   - read from the store; return RecordingMeta unchanged, it is already small
 *   - fill in the JSON Schema: a description on the tool and on every non-obvious field, plus one
 *     concrete example. The schema is the interface a model reads; a vague field is a wrong call.
 *   - enforce this tool's response budget, and phrase any truncation note as an instruction the
 *     agent can act on rather than as a note that something was cut.
 */
export const readSessionMetaTool: ToolDefinition = {
  name: 'read_session_meta',
  description: "Get the shape of the recording before anything else: duration, viewport, browser, pages visited, and counts of clicks, inputs, console errors and failed requests. Call this first, because every other tool takes times in ms relative to the start of the recording.",

  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },

  async execute() {
    return notImplemented('read_session_meta')
  },
}
