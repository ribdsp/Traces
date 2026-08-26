import { type ToolDefinition, notImplemented } from '../tool-types'

/**
 * 'annotate' — see docs/tools.md for the full contract.
 *
 * Owner: Vicko.
 *
 * TODO(vicko), Day 3:
 *   - addMarker with author agent; reject labels longer than about 80 characters
 *   - fill in the JSON Schema: a description on the tool and on every non-obvious field, plus one
 *     concrete example. The schema is the interface a model reads; a vague field is a wrong call.
 *   - enforce this tool's response budget, and phrase any truncation note as an instruction the
 *     agent can act on rather than as a note that something was cut.
 */
export const annotateTool: ToolDefinition = {
  name: 'annotate',
  description: "Put a labelled marker on the human's timeline at a given moment. Markers you create are shown as yours, and the human can accept, reject or undo each one individually.",

  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },

  async execute() {
    return notImplemented('annotate')
  },
}
