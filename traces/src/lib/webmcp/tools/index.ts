import type { ToolDefinition } from '../tool-types'

import { readSessionMetaTool } from './read-session-meta'
import { listEventsTool } from './list-events'
import { findElementTool } from './find-element'
import { readDomAtTool } from './read-dom-at'
import { bisectTool } from './bisect'
import { diffDomToolDefinition } from './diff-dom'
import { readConsoleTool } from './read-console'
import { readNetworkTool } from './read-network'
import { measureLayoutToolDefinition } from './measure-layout'
import { seekTool } from './seek'
import { annotateTool } from './annotate'
import { askHumanVisualTool } from './ask-human-visual'
import { proposeHypothesesTool } from './propose-hypotheses'
import { proposeReportTool } from './propose-report'
import { claimNextTaskTool } from './claim-next-task'
import { snapshotFindingTool } from './snapshot-finding'

/**
 * Every tool Traces exposes, in the order a model should discover them.
 *
 * Owner: Vicko. Contract: docs/tools.md.
 *
 * The order matters more than it looks. Models read a tool list top-down and reach for the first
 * thing that plausibly fits, so the cheap orienting tools come first and the expensive or blocking
 * ones come last. A list that opens with `propose_report` gets you a report before an investigation.
 *
 * Grouped by what they do rather than by who wrote them:
 *
 *   read      — answer a question about the recording without changing anything
 *   search    — make the page compute something the agent cannot compute itself
 *   act       — change what the human is looking at, and leave a visible trace of who did it
 *   collaborate — hand something to the human and wait for their judgement
 */
export const allTools: ToolDefinition[] = [
  // read
  readSessionMetaTool,
  listEventsTool,
  findElementTool,
  readDomAtTool,
  readConsoleTool,
  readNetworkTool,

  // search
  bisectTool,
  diffDomToolDefinition,
  measureLayoutToolDefinition,

  // act
  seekTool,
  annotateTool,

  // collaborate
  askHumanVisualTool,
  proposeHypothesesTool,
  proposeReportTool,
  claimNextTaskTool,
  snapshotFindingTool,
]

/** Fails fast on a copy-pasted `name` — two tools with one name silently shadow each other. */
export function assertUniqueToolNames(tools: ToolDefinition[] = allTools): void {
  const seen = new Set<string>()

  for (const tool of tools) {
    if (seen.has(tool.name)) {
      throw new Error(`Duplicate tool name '${tool.name}' in allTools`)
    }
    seen.add(tool.name)
  }
}

export {
  readSessionMetaTool,
  listEventsTool,
  findElementTool,
  readDomAtTool,
  bisectTool,
  diffDomToolDefinition,
  readConsoleTool,
  readNetworkTool,
  measureLayoutToolDefinition,
  seekTool,
  annotateTool,
  askHumanVisualTool,
  proposeHypothesesTool,
  proposeReportTool,
  claimNextTaskTool,
  snapshotFindingTool,
}
