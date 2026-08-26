import { type ToolDefinition, notImplemented } from '../tool-types'

/**
 * 'snapshot_finding' — see docs/tools.md for the full contract.
 *
 * Owner: Vicko.
 *
 * TODO(vicko), Day 5:
 *   - serialize markers, hypotheses and report to localStorage; return a short confirmation
 *   - fill in the JSON Schema: a description on the tool and on every non-obvious field, plus one
 *     concrete example. The schema is the interface a model reads; a vague field is a wrong call.
 *   - enforce this tool's response budget, and phrase any truncation note as an instruction the
 *     agent can act on rather than as a note that something was cut.
 */
export const snapshotFindingTool: ToolDefinition = {
  name: 'snapshot_finding',
  description: "Save the current findings, meaning markers, hypotheses and the report draft, so they survive a reload and can be copied out.",

  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },

  async execute() {
    return notImplemented('snapshot_finding')
  },
}
