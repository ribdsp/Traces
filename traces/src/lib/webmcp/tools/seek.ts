import { type ToolDefinition, notImplemented } from '../tool-types'

/**
 * 'seek' — see docs/tools.md for the full contract.
 *
 * Owner: Vicko.
 *
 * TODO(vicko), Day 3:
 *   - setCurrentTime with author agent; confirm the resulting position in the response
 *   - fill in the JSON Schema: a description on the tool and on every non-obvious field, plus one
 *     concrete example. The schema is the interface a model reads; a vague field is a wrong call.
 *   - enforce this tool's response budget, and phrase any truncation note as an instruction the
 *     agent can act on rather than as a note that something was cut.
 */
export const seekTool: ToolDefinition = {
  name: 'seek',
  description: "Move the human's playhead to a moment in the recording so they are looking at what you are talking about. Call this before asking them a question.",

  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },

  async execute() {
    return notImplemented('seek')
  },
}
