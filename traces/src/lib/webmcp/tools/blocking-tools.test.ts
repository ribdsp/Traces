import { beforeEach, describe, expect, it } from 'vitest'
import type { Recording } from '@/types/domain'
import { sessionActions, sessionState, useSessionStore } from '@/lib/store/session'
import type { ToolResponse } from '../tool-types'
import { annotateTool } from './annotate'
import { askHumanVisualTool } from './ask-human-visual'
import { claimNextTaskTool } from './claim-next-task'
import { proposeHypothesesTool } from './propose-hypotheses'
import { answerReportReview, proposeReportTool } from './propose-report'
import { seekTool } from './seek'
import { snapshotFindingTool } from './snapshot-finding'

/**
 * The wiring, not the algorithms: does the human's action actually reach the agent, and does every
 * failure path come back as a sentence rather than a hang.
 *
 * Every blocking case here settles through the store — a human answering — rather than by waiting out
 * GATE_TIMEOUT_MS, which would add its full duration to every test. The timeout path itself is
 * already pinned in blocking.test.ts; what these tests add is that the *store* half is connected to it,
 * because a gate nobody can answer and a gate nobody is watching look identical from the agent's side.
 */

const STARTED_AT = 1_700_000_000_000

function fixture(durationMs = 5_000): Recording {
  return {
    id: 'test-recording',
    label: 'Test recording',
    startedAt: STARTED_AT,
    durationMs,
    events: [
      { type: 2, timestamp: STARTED_AT, data: {} },
      // A real click at 1000ms, so one proposed step can actually verify against the event stream.
      { type: 3, timestamp: STARTED_AT + 1_000, data: { source: 2, type: 2, id: 7 } },
    ],
    meta: {
      recordingId: 'test-recording',
      durationMs,
      eventCount: 2,
      viewport: { width: 1280, height: 800 },
      userAgent: 'vitest',
      navigations: [],
      counts: { clicks: 1, inputs: 0, consoleErrors: 0, failedRequests: 0 },
    },
  }
}

function payload(response: ToolResponse): Record<string, unknown> {
  const first = response.content[0]
  return JSON.parse(first?.text ?? '{}') as Record<string, unknown>
}

function message(response: ToolResponse): string {
  return response.content[0]?.text ?? ''
}

/** Let an `execute` reach its first await, so the store reflects what it opened. */
const tick = (): Promise<void> => Promise.resolve()

beforeEach(() => {
  useSessionStore.getState().reset()
  useSessionStore.getState().loadRecording(fixture(), [0])
})

describe('annotate', () => {
  it('marks the timeline as the agent, so the human can undo exactly that one thing', async () => {
    const response = await annotateTool.execute({ timestamp: 1_200, label: 'province list empty', severity: 'error' })
    const body = payload(response)

    expect(response.isError).toBeUndefined()
    expect(body['at']).toBe(1_200)

    const marker = sessionState().markers.find((candidate) => candidate.id === body['id'])
    expect(marker?.author).toBe('agent')
    expect(marker?.severity).toBe('error')
  })

  it("rejects the severities docs/tools.md still documents, and names the ones that exist", async () => {
    const response = await annotateTool.execute({ timestamp: 1_200, label: 'x', severity: 'high' })

    expect(response.isError).toBe(true)
    expect(message(response)).toContain('info, warn, error')
  })

  it('rejects a label too long to render under a pin rather than clipping it silently', async () => {
    const response = await annotateTool.execute({
      timestamp: 1_200,
      label: 'x'.repeat(120),
      severity: 'info',
    })

    expect(response.isError).toBe(true)
    expect(message(response)).toMatch(/80/)
    expect(sessionState().markers).toHaveLength(0)
  })

  it('does not stack a second pin when the same call is reissued', async () => {
    const first = payload(await annotateTool.execute({ timestamp: 1_200, label: 'same', severity: 'warn' }))
    const second = payload(await annotateTool.execute({ timestamp: 1_200, label: 'same', severity: 'warn' }))

    expect(second['id']).toBe(first['id'])
    expect(sessionState().markers).toHaveLength(1)
  })

  it('explains itself when no recording is loaded', async () => {
    useSessionStore.getState().reset()
    const response = await annotateTool.execute({ timestamp: 0, label: 'x', severity: 'info' })

    expect(response.isError).toBe(true)
    expect(message(response)).toMatch(/No recording/)
  })
})

describe('seek', () => {
  it('says the player is not mounted instead of throwing', async () => {
    const response = await seekTool.execute({ timestamp: 1_000 })

    expect(response.isError).toBe(true)
    expect(message(response)).toMatch(/player has not mounted/)
    // Nothing moved, so nothing is claimed in the activity feed either.
    expect(sessionState().currentTime).toBe(0)
  })

  it('rejects a non-numeric timestamp readably', async () => {
    const response = await seekTool.execute({ timestamp: 'the end' })

    expect(response.isError).toBe(true)
    expect(message(response)).toMatch(/finite number/)
  })
})

describe('snapshot_finding', () => {
  it('refuses to save an empty session and says what to do first', async () => {
    const response = await snapshotFindingTool.execute({})

    expect(response.isError).toBe(true)
    expect(message(response)).toMatch(/nothing to save/)
  })

  it('writes the findings somewhere a reload can find them', async () => {
    await annotateTool.execute({ timestamp: 1_200, label: 'province list empty', severity: 'error' })
    const body = payload(await snapshotFindingTool.execute({ name: 'Empty province dropdown' }))

    const key = body['id']
    expect(typeof key).toBe('string')
    expect(localStorage.getItem(String(key))).toContain('province list empty')
  })
})

describe('claim_next_task', () => {
  it('hands over a task that is already waiting, with no gate at all', async () => {
    const taskId = sessionActions().addTask('Find when the province dropdown went empty', 'human')
    const body = payload(await claimNextTaskTool.execute({}))

    expect(body['status']).toBe('answered')
    expect(body['taskId']).toBe(taskId)
    expect(sessionState().tasks[0]?.status).toBe('claimed')
  })

  it('blocks until a human drops one in, which is the point of the tool', async () => {
    const call = claimNextTaskTool.execute({})
    await tick()
    expect(sessionState().tasks).toHaveLength(0)

    sessionActions().addTask('Check the network calls around 2s', 'human')
    const body = payload(await call)

    expect(body['status']).toBe('answered')
    expect(body['text']).toBe('Check the network calls around 2s')
  })

  it('never hands the same task to two waiting calls', async () => {
    const first = claimNextTaskTool.execute({})
    const second = claimNextTaskTool.execute({})
    await tick()

    sessionActions().addTask('task one', 'human')
    sessionActions().addTask('task two', 'human')

    const bodies = [payload(await first), payload(await second)]
    const ids = bodies.map((body) => body['taskId'])

    expect(new Set(ids).size).toBe(2)
    expect(bodies.map((body) => body['text']).sort()).toEqual(['task one', 'task two'])
  })

  it('turns an unknown ticket into an instruction rather than a hang', async () => {
    const response = await claimNextTaskTool.execute({ ticket: 'task-notathing' })

    expect(response.isError).toBe(true)
    expect(message(response)).toMatch(/without a ticket to start a fresh request/)
  })
})

describe('ask_human_visual', () => {
  it("resolves with the human's choice and the moment they marked", async () => {
    const call = askHumanVisualTool.execute({
      question: 'Did the province dropdown look broken, or just empty?',
      choices: ['looked broken', 'looked normal but empty'],
    })
    await tick()

    const ask = sessionState().pendingAsk
    expect(ask).not.toBeNull()

    sessionActions().answerAsk(ask?.id ?? '', { choice: 'looked normal but empty', markedTimestamp: 2_500 })
    const body = payload(await call)

    expect(body['status']).toBe('answered')
    expect(body['choice']).toBe('looked normal but empty')
    expect(body['markedTimestamp']).toBe(2_500)
  })

  it("turns the human's answer into evidence on the timeline, authored by them", async () => {
    const call = askHumanVisualTool.execute({
      question: 'Did it look broken?',
      choices: ['yes', 'no'],
    })
    await tick()

    const ask = sessionState().pendingAsk
    sessionActions().answerAsk(ask?.id ?? '', { choice: 'yes', markedTimestamp: 2_500 })
    await call

    const marker = sessionState().markers.find((candidate) => candidate.timestamp === 2_500)
    expect(marker?.author).toBe('human')
    expect(marker?.label).toContain('yes')
  })

  it('reattaches to the open question when the agent asks again without its ticket', async () => {
    const first = askHumanVisualTool.execute({ question: 'Did it look broken?', choices: ['yes', 'no'] })
    await tick()
    const askId = sessionState().pendingAsk?.id ?? ''

    const second = askHumanVisualTool.execute({ question: 'Did it look broken?', choices: ['yes', 'no'] })
    await tick()

    // Still one question: a second prompt would have replaced the one the human is answering.
    expect(sessionState().pendingAsk?.id).toBe(askId)

    sessionActions().answerAsk(askId, { choice: 'no', markedTimestamp: 1_000 })

    expect(payload(await first)['choice']).toBe('no')
    expect(payload(await second)['choice']).toBe('no')
    // One answer, one marker — not one per waiting call.
    expect(sessionState().markers.filter((marker) => marker.author === 'human')).toHaveLength(1)
  })

  it('resolves when the human dismisses the question instead of leaving the agent waiting', async () => {
    const call = askHumanVisualTool.execute({ question: 'Did it look broken?', choices: ['yes', 'no'] })
    await tick()

    sessionActions().clearAsk()
    const response = await call

    expect(response.isError).toBe(true)
    expect(message(response)).toMatch(/closed the question without answering/)
  })

  it('points the human at the moment it is asking about', async () => {
    const call = askHumanVisualTool.execute({
      question: 'Did it look broken?',
      choices: ['yes', 'no'],
      hintAtMs: 2_000,
    })
    await tick()

    expect(sessionState().currentTime).toBe(2_000)
    expect(sessionState().pendingAsk?.hintAtMs).toBe(2_000)

    sessionActions().answerAsk(sessionState().pendingAsk?.id ?? '', { choice: 'yes', markedTimestamp: 2_100 })
    expect(payload(await call)['markedTimestamp']).toBe(2_100)
  })

  it('rejects a choice list a human cannot answer', async () => {
    const response = await askHumanVisualTool.execute({ question: 'Did it look broken?', choices: ['yes'] })

    expect(response.isError).toBe(true)
    expect(sessionState().pendingAsk).toBeNull()
  })
})

describe('propose_hypotheses', () => {
  const twoValid = {
    hypotheses: [
      { text: 'The province list never loads', confidence: 0.9, evidence: [{ atMs: 1_000, note: 'select empty' }] },
      { text: 'Changing country resets it', confidence: 0.9, evidence: [{ atMs: 2_000, note: 'reset' }] },
    ],
  }

  it('normalises the confidences it puts on the cards', async () => {
    const call = proposeHypothesesTool.execute(twoValid)
    await tick()

    expect(sessionState().hypotheses.map((hypothesis) => hypothesis.confidence)).toEqual([0.5, 0.5])

    const first = sessionState().hypotheses[0]
    sessionActions().promoteHypothesis(first?.id ?? '', 'human')
    const body = payload(await call)

    expect(body['status']).toBe('answered')
    expect(body['promoted']).toEqual([first?.id])
  })

  it('settles when every card has been rejected, and tells the agent not to re-send them', async () => {
    const call = proposeHypothesesTool.execute(twoValid)
    await tick()

    for (const hypothesis of sessionState().hypotheses) {
      sessionActions().rejectHypothesis(hypothesis.id, 'human')
    }

    const body = payload(await call)
    expect(body['promoted']).toEqual([])
    expect(body['rejected']).toHaveLength(2)
    expect(String(body['nextStep'])).toMatch(/do not re-send/i)
  })

  it('refuses a hypothesis with no evidence before it ever reaches a card', async () => {
    const response = await proposeHypothesesTool.execute({
      hypotheses: [
        { text: 'a', confidence: 0.5, evidence: [{ atMs: 1_000 }] },
        { text: 'a hunch', confidence: 0.5, evidence: [] },
      ],
    })

    expect(response.isError).toBe(true)
    expect(sessionState().hypotheses).toHaveLength(0)
  })
})

describe('propose_report', () => {
  it('passes the draft through buildReport and reports which steps the recording supports', async () => {
    const call = proposeReportTool.execute({
      title: 'Province dropdown is empty',
      steps: [
        { text: 'Click the province dropdown', atMs: 1_000 },
        { text: 'Select a province', atMs: 4_900 },
      ],
      rootCause: 'The province request fails and nothing retries it.',
    })
    await tick()

    const draft = sessionState().report
    expect(draft?.author).toBe('agent')
    // Step one sits on a real recorded click; step two claims a moment nothing supports.
    expect(draft?.steps.map((step) => step.verified)).toEqual([true, false])

    expect(answerReportReview({ approved: true })).toBe(true)
    const body = payload(await call)

    expect(body['status']).toBe('answered')
    expect(body['approved']).toBe(true)
    expect(body['unverifiedCount']).toBe(1)
    expect(String(body['nextStep'])).toMatch(/unverified/)
  })

  it('comes back as an unapproved answer, not an error, when the human says no', async () => {
    const call = proposeReportTool.execute({
      title: 'Province dropdown is empty',
      steps: [{ text: 'Click the province dropdown', atMs: 1_000 }],
      rootCause: 'Unclear.',
    })
    await tick()

    answerReportReview({ approved: false })
    const body = payload(await call)

    expect(body['approved']).toBe(false)
    expect(String(body['nextStep'])).toMatch(/Do not re-send it unchanged/)
  })

  it("settles as approved when the human edits the draft, since that is also them acting on it", async () => {
    const call = proposeReportTool.execute({
      title: 'Province dropdown is empty',
      steps: [{ text: 'Click the province dropdown', atMs: 1_000 }],
      rootCause: 'The province request fails.',
    })
    await tick()

    const draft = sessionState().report
    expect(draft).not.toBeNull()
    if (draft !== null) {
      sessionActions().setReport({ ...draft, title: 'Checkout blocked: province list empty', author: 'human' }, 'human')
    }

    const body = payload(await call)
    expect(body['approved']).toBe(true)
    expect(body['editedByHuman']).toBe(true)
    expect(String(body['finalText'])).toContain('Checkout blocked')
  })

  it('requires a title and a root cause rather than drafting around them', async () => {
    const response = await proposeReportTool.execute({ steps: [], rootCause: 'x' })

    expect(response.isError).toBe(true)
    expect(message(response)).toMatch(/'title'/)
    expect(sessionState().report).toBeNull()
  })
})
