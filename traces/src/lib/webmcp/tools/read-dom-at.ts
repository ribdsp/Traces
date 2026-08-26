import { type ToolDefinition, notImplemented } from '../tool-types'

/**
 * 'read_dom_at' — see docs/tools.md for the full contract.
 *
 * Owner: Vicko.
 *
 * TODO(vicko), Day 3:
 *   - gotoTime then compressDom; return dom plus lineCount, charCount and truncated
 *   - fill in the JSON Schema: a description on the tool and on every non-obvious field, plus one
 *     concrete example. The schema is the interface a model reads; a vague field is a wrong call.
 *   - enforce this tool's response budget, and phrase any truncation note as an instruction the
 *     agent can act on rather than as a note that something was cut.
 */
export const readDomAtTool: ToolDefinition = {
  name: 'read_dom_at',
  description: "Read the state of the page at a moment in time as a compressed list of interactive and state-bearing elements. This is not HTML: layout wrappers and styling are removed and the result is capped at 60 lines. Pass a selector to scope it when the whole page is too broad.",

  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },

  async execute() {
    return notImplemented('read_dom_at')
  },
}
