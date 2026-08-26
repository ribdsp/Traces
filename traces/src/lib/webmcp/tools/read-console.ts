import { type ToolDefinition, notImplemented } from '../tool-types'

/**
 * 'read_console' — see docs/tools.md for the full contract.
 *
 * Owner: Vicko.
 *
 * TODO(vicko), Day 3:
 *   - filter the digest to console kinds; truncate each message to 200 characters
 *   - fill in the JSON Schema: a description on the tool and on every non-obvious field, plus one
 *     concrete example. The schema is the interface a model reads; a vague field is a wrong call.
 *   - enforce this tool's response budget, and phrase any truncation note as an instruction the
 *     agent can act on rather than as a note that something was cut.
 */
export const readConsoleTool: ToolDefinition = {
  name: 'read_console',
  description: "Read console messages in a time window, most severe first. Each message is truncated to 200 characters.",

  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },

  async execute() {
    return notImplemented('read_console')
  },
}
