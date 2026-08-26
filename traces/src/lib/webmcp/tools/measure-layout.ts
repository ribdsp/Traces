import { type ToolDefinition, notImplemented } from '../tool-types'

/**
 * 'measure_layout' — see docs/tools.md for the full contract.
 *
 * Owner: Vicko.
 *
 * TODO(vicko), Day 5:
 *   - wrap measureLayout; round every number before returning it
 *   - fill in the JSON Schema: a description on the tool and on every non-obvious field, plus one
 *     concrete example. The schema is the interface a model reads; a vague field is a wrong call.
 *   - enforce this tool's response budget, and phrase any truncation note as an instruction the
 *     agent can act on rather than as a note that something was cut.
 */
export const measureLayoutToolDefinition: ToolDefinition = {
  name: 'measure_layout',
  description: "Measure the position, size, visibility and stacking of specific elements at a moment, and report which of them overlap. Use this to check whether something invisible is covering an element the user tried to click.",

  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },

  async execute() {
    return notImplemented('measure_layout')
  },
}
