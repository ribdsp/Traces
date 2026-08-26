import type { SessionState, Task } from '@/types/domain'
import { sessionActions, sessionState } from '@/lib/store/session'
import { type ToolDefinition, type ToolResponse, json, toolError } from '../tool-types'
import { answerGate, createGate } from '../blocking'
import {
  TICKET_FIELD,
  capText,
  collectRetry,
  optionalString,
  pendingResponse,
  watchForHuman,
} from './tool-support'

/**
 * 'claim_next_task' — see docs/tools.md for the full contract.
 *
 * Owner: Vicko.
 *
 * This is the tool that inverts who waits on whom. Everywhere else an agent is invoked and a person
 * waits for it; here the agent parks itself on the human's queue and picks up work the moment it
 * appears. That is only true because `execute()` genuinely does not resolve until a task exists.
 *
 * Implemented — vicko, Day 4:
 *   - a task already open is handed over immediately, with no gate at all
 *   - otherwise `createGate('task')`, and a store watcher claims the next task a human types
 *   - claiming happens inside the watcher's detector rather than after it, so the check and the write
 *     are one step. `claimTask` returns null for an already-claimed task (see lib/store/session.ts), so
 *     two waiting calls cannot be handed the same work: the loser keeps waiting for the next one.
 *   - with a `ticket`, `retryGate` reattaches to the same wait. The watcher deliberately outlives the
 *     timeout, because a human typing a task between two polls has to be caught by *something*.
 *
 * Deliberately does not require a loaded recording. Waiting for work is what an idle agent does, and a
 * tool that refuses until a recording exists cannot be the thing that tells it one is ready.
 */

/** A task is a sentence, not a brief. Long enough for a real instruction, capped so it stays one. */
export const TASK_TEXT_MAX = 400

/**
 * Claim the first open task, or null if there is none.
 *
 * Mutates the store on purpose: this is the detector `watchForHuman` runs, and separating "find one"
 * from "claim it" would open a window in which two waiting calls both believe they got it.
 */
function claimFirstOpen(state: SessionState): Task | null {
  const actions = sessionActions()
  for (const task of state.tasks) {
    if (task.status !== 'open') continue
    const claimed = actions.claimTask(task.id)
    if (claimed !== null) return claimed
  }
  return null
}

function claimed(task: Task): ToolResponse {
  const text = capText(task.text, TASK_TEXT_MAX)
  return json({
    status: 'answered',
    taskId: task.id,
    text: text.text,
    claimedAt: task.claimedAt ?? Date.now(),
    ...(text.truncated
      ? {
          truncated: true,
          nextStep:
            `The task text was longer than ${TASK_TEXT_MAX} characters and is shown up to that point. Ask the ` +
            'human to restate what they want in one sentence rather than guessing at the rest.',
        }
      : {}),
  })
}

export const claimNextTaskTool: ToolDefinition = {
  name: 'claim_next_task',
  description: "Take the next task the human has put in the agent lane. This call blocks until a task exists, so you can use it to wait for work instead of polling.",

  inputSchema: {
    type: 'object',
    properties: {
      ticket: TICKET_FIELD,
    },
    additionalProperties: false,
  },

  async execute(args) {
    const ticket = optionalString(args, 'ticket')
    if (!ticket.ok) return toolError(ticket.error)

    if (ticket.value !== null) {
      const collected = await collectRetry<Task>(
        'claim_next_task',
        ticket.value,
        'the human to put a task in the agent lane',
      )
      return collected.kind === 'response' ? collected.response : claimed(collected.value)
    }

    const waiting = claimFirstOpen(sessionState())
    if (waiting !== null) return claimed(waiting)

    const gate = createGate<Task>('task')
    const cancel = watchForHuman<Task>(claimFirstOpen, (task) => {
      answerGate(gate.ticket, task)
    })

    const result = await gate.promise
    if (result.status === 'answered') {
      cancel()
      return claimed(result.value)
    }

    // Not cancelled: the wait is still live, and the ticket is how the agent gets back to it.
    return pendingResponse('claim_next_task', result.ticket, 'the human to put a task in the agent lane')
  },
}
