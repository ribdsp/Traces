import { type ToolDefinition, notImplemented } from '../tool-types'

/**
 * 'claim_next_task' — see docs/tools.md for the full contract.
 *
 * Owner: Vicko.
 *
 * TODO(vicko), Day 4:
 *   - blocking: resolve immediately when a task is open, otherwise gate on the next one
 *   - fill in the JSON Schema: a description on the tool and on every non-obvious field, plus one
 *     concrete example. The schema is the interface a model reads; a vague field is a wrong call.
 *   - enforce this tool's response budget, and phrase any truncation note as an instruction the
 *     agent can act on rather than as a note that something was cut.
 */
export const claimNextTaskTool: ToolDefinition = {
  name: 'claim_next_task',
  description: "Take the next task the human has put in the agent lane. This call blocks until a task exists, so you can use it to wait for work instead of polling.",

  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },

  async execute() {
    return notImplemented('claim_next_task')
  },
}
