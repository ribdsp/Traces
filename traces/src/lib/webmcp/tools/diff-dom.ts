import { type ToolDefinition, notImplemented } from '../tool-types'

/**
 * 'diff_dom' — see docs/tools.md for the full contract.
 *
 * Owner: Vicko.
 *
 * TODO(vicko), Day 5:
 *   - position the engine at both times and diff the compressed trees, not the raw ones
 *   - fill in the JSON Schema: a description on the tool and on every non-obvious field, plus one
 *     concrete example. The schema is the interface a model reads; a vague field is a wrong call.
 *   - enforce this tool's response budget, and phrase any truncation note as an instruction the
 *     agent can act on rather than as a note that something was cut.
 */
export const diffDomToolDefinition: ToolDefinition = {
  name: 'diff_dom',
  description: "Show what changed between two moments as a short list of added, removed and changed elements. Useful straight after bisect, to see what else changed at the same instant.",

  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },

  async execute() {
    return notImplemented('diff_dom')
  },
}
