import { type ToolDefinition, notImplemented } from '../tool-types'

/**
 * 'propose_hypotheses' — see docs/tools.md for the full contract.
 *
 * Owner: Vicko.
 *
 * TODO(vicko), Day 4:
 *   - blocking: createGate('hypotheses'); require 2 to 4, each with at least one evidence timestamp
 *   - fill in the JSON Schema: a description on the tool and on every non-obvious field, plus one
 *     concrete example. The schema is the interface a model reads; a vague field is a wrong call.
 *   - enforce this tool's response budget, and phrase any truncation note as an instruction the
 *     agent can act on rather than as a note that something was cut.
 */
export const proposeHypothesesTool: ToolDefinition = {
  name: 'propose_hypotheses',
  description: "Propose two to four ranked explanations, each with the timestamps that support it, then wait for the human to promote or reject them. This call blocks until they decide.",

  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },

  async execute() {
    return notImplemented('propose_hypotheses')
  },
}
