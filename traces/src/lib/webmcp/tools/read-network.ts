import { type ToolDefinition, notImplemented } from '../tool-types'

/**
 * 'read_network' — see docs/tools.md for the full contract.
 *
 * Owner: Vicko.
 *
 * TODO(vicko), Day 3:
 *   - summarize bodies, never forward them whole; see docs/threat-model.md T4
 *   - fill in the JSON Schema: a description on the tool and on every non-obvious field, plus one
 *     concrete example. The schema is the interface a model reads; a vague field is a wrong call.
 *   - enforce this tool's response budget, and phrase any truncation note as an instruction the
 *     agent can act on rather than as a note that something was cut.
 */
export const readNetworkTool: ToolDefinition = {
  name: 'read_network',
  description: "Read network requests in a time window: method, URL, status and duration. Response bodies are summarized, never returned whole.",

  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },

  async execute() {
    return notImplemented('read_network')
  },
}
