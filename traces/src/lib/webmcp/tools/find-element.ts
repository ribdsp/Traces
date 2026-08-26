import { type ToolDefinition, notImplemented } from '../tool-types'

/**
 * 'find_element' — see docs/tools.md for the full contract.
 *
 * Owner: Vicko.
 *
 * TODO(vicko), Day 3:
 *   - validateSelector, query the mirror document, return up to 5 matches with a stable selector each
 *   - fill in the JSON Schema: a description on the tool and on every non-obvious field, plus one
 *     concrete example. The schema is the interface a model reads; a vague field is a wrong call.
 *   - enforce this tool's response budget, and phrase any truncation note as an instruction the
 *     agent can act on rather than as a note that something was cut.
 */
export const findElementTool: ToolDefinition = {
  name: 'find_element',
  description: "Find elements matching a CSS selector at a moment in time, with up to 5 matches and a stable selector for each. Use this before bisect to confirm an element exists and to get a selector that keeps matching as the page changes.",

  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },

  async execute() {
    return notImplemented('find_element')
  },
}
