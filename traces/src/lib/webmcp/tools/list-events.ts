import { type ToolDefinition, notImplemented } from '../tool-types'

/**
 * 'list_events' — see docs/tools.md for the full contract.
 *
 * Owner: Vicko.
 *
 * TODO(vicko), Day 3:
 *   - wrap buildEventDigest; cap at 40 entries and keep the earliest ones on truncation
 *   - fill in the JSON Schema: a description on the tool and on every non-obvious field, plus one
 *     concrete example. The schema is the interface a model reads; a vague field is a wrong call.
 *   - enforce this tool's response budget, and phrase any truncation note as an instruction the
 *     agent can act on rather than as a note that something was cut.
 */
export const listEventsTool: ToolDefinition = {
  name: 'list_events',
  description: "List the interesting things that happened, in order: clicks, inputs, navigations, console errors, failed requests, and repeated clicking on the same element. Returns at most 40 entries, so narrow the window or the kinds rather than asking for more.",

  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },

  async execute() {
    return notImplemented('list_events')
  },
}
