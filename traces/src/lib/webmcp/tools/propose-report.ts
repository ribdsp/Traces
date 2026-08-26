import { type ToolDefinition, notImplemented } from '../tool-types'

/**
 * 'propose_report' — see docs/tools.md for the full contract.
 *
 * Owner: Vicko.
 *
 * TODO(vicko), Day 5:
 *   - buildReport first, then gate on approval; never present an unverified step as verified
 *   - fill in the JSON Schema: a description on the tool and on every non-obvious field, plus one
 *     concrete example. The schema is the interface a model reads; a vague field is a wrong call.
 *   - enforce this tool's response budget, and phrase any truncation note as an instruction the
 *     agent can act on rather than as a note that something was cut.
 */
export const proposeReportTool: ToolDefinition = {
  name: 'propose_report',
  description: "Propose a bug report and wait for the human to approve or edit it. Reproduction steps are validated against the recorded events, and any step no event supports is marked unverified rather than quietly dropped.",

  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },

  async execute() {
    return notImplemented('propose_report')
  },
}
