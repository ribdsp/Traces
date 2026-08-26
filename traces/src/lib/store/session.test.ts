import { beforeEach, describe, expect, it } from 'vitest'
import {
  consumeAskAnswer,
  sessionActions,
  sessionState,
  severityOf,
  useSessionStore,
} from './session'
import type { Hypothesis, Marker, Recording, Report } from '@/types/domain'

/**
 * Focused rather than exhaustive, on purpose.
 *
 * The store isn't on CONTRIBUTING's "tested thoroughly" list — a broken action announces itself the
 * moment the page opens. What these tests pin are the four things that would fail *silently*, long
 * after the change that broke them:
 *
 *   1. every entry the actions create carries an `author`, because the feed's whole claim is that
 *      agent and human contributions are distinguishable
 *   2. `undo(id)` reverses exactly one contribution, not the session
 *   3. a rejected marker survives, since undo and restore both need it to still be there
 *   4. nothing mutates an array it was handed, or an array it already published
 *
 * Everything else here exists because it encodes a decision someone will otherwise "fix" — the
 * single-slot ask, the double claim, the deliberately unlogged human seek.
 */

const recording = (durationMs = 47_000): Recording => ({
  id: 'empty-province',
  label: 'Empty province',
  events: [{ type: 2, timestamp: 0, data: {} }],
  startedAt: 0,
  durationMs,
  meta: {
    recordingId: 'empty-province',
    durationMs,
    eventCount: 1,
    viewport: { width: 1280, height: 800 },
    userAgent: 'test',
    navigations: [],
    counts: { clicks: 0, inputs: 0, consoleErrors: 0, failedRequests: 0 },
  },
})

const marker = (overrides: Partial<Omit<Marker, 'id'>> = {}): Omit<Marker, 'id'> => ({
  timestamp: 28_412,
  label: 'province dropdown has zero options',
  severity: 'error',
  author: 'agent',
  ...overrides,
})

const hypothesis = (overrides: Partial<Omit<Hypothesis, 'id'>> = {}): Omit<Hypothesis, 'id'> => ({
  text: 'the province list request returned an empty array',
  confidence: 0.8,
  evidence: [{ atMs: 28_412, note: 'dropdown empty' }],
  status: 'proposed',
  author: 'agent',
  ...overrides,
})

const report = (overrides: Partial<Report> = {}): Report => ({
  title: 'Province dropdown is empty after selecting a country',
  summary: 'The dependent select never repopulates.',
  steps: [{ text: 'Select a country', atMs: 12_000, verified: true }],
  expected: 'provinces listed',
  actual: 'no options',
  rootCause: 'empty response',
  evidence: [{ atMs: 28_412, note: 'zero options' }],
  author: 'agent',
  ...overrides,
})

/** The entry an undo button would be rendered on. */
const undoableEntryId = (): string => {
  const entry = sessionState().activity.find((candidate) => candidate.undoable)
  if (!entry) throw new Error('expected an undoable activity entry')
  return entry.id
}

beforeEach(() => {
  sessionActions().reset()
})

describe('every mutation is attributed', () => {
  it('gives every entry an author, a description and a wall-clock time', () => {
    const before = Date.now()
    const actions = sessionActions()

    actions.loadRecording(recording(), [0, 20_000])
    actions.addMarker(marker())
    actions.addMarker(marker({ author: 'human', timestamp: 30_000, label: 'human note' }))
    const [firstHypothesis] = actions.addHypotheses([hypothesis(), hypothesis({ confidence: 0.4 })])
    actions.promoteHypothesis(firstHypothesis ?? '', 'human')
    const taskId = actions.addTask('find when the province dropdown went empty', 'human')
    actions.claimTask(taskId)
    actions.completeTask(taskId)
    const askId = actions.openAsk({ question: 'Did it look broken or just empty?', choices: ['broken', 'empty'] })
    actions.answerAsk(askId, { choice: 'empty', markedTimestamp: 28_412 })
    actions.setBisectTrace([{ atMs: 20_000, result: false }, { atMs: 28_412, result: true }])
    actions.setReport(report(), 'agent')
    actions.setCurrentTime(28_412, 'agent')

    const { activity } = sessionState()
    expect(activity.length).toBeGreaterThan(10)

    for (const entry of activity) {
      expect(['human', 'agent']).toContain(entry.author)
      expect(entry.description.length).toBeGreaterThan(0)
      // One line, past tense is a wording rule a test can't enforce; the newline ban it can.
      expect(entry.description).not.toContain('\n')
      expect(entry.at).toBeGreaterThanOrEqual(before)
      expect(entry.id).not.toBe('')
    }

    // Wall clock, not recording time: 28412 is a moment in the recording, never an entry's `at`.
    expect(activity.some((entry) => entry.at === 28_412)).toBe(false)
  })

  it('marks only agent entries undoable', () => {
    const actions = sessionActions()
    actions.addMarker(marker({ author: 'human' }))
    actions.addTask('a human task', 'human')

    expect(sessionState().activity.every((entry) => entry.undoable !== true)).toBe(true)

    actions.addMarker(marker())
    expect(sessionState().activity.filter((entry) => entry.undoable === true)).toHaveLength(1)
  })

  it('attributes the author given, not the author of the last call', () => {
    const actions = sessionActions()
    const id = actions.addMarker(marker())
    actions.rejectMarker(id)

    const [created, rejected] = sessionState().activity
    expect(created?.author).toBe('agent')
    // Rejection is the human's veto by construction — the action takes no author for that reason.
    expect(rejected?.author).toBe('human')
  })
})

describe('undo reverses exactly one contribution', () => {
  it('removes one agent marker and leaves the rest of the session standing', () => {
    const actions = sessionActions()
    actions.loadRecording(recording(), [])
    const first = actions.addMarker(marker())
    const entryId = undoableEntryId()
    const second = actions.addMarker(marker({ timestamp: 30_000, label: 'second finding' }))
    actions.addHypotheses([hypothesis()])

    actions.undo(entryId)

    const state = sessionState()
    expect(state.markers.map((item) => item.id)).toEqual([second])
    expect(state.hypotheses).toHaveLength(1)
    expect(state.recording).not.toBeNull()
    expect(first).not.toBe(second)
  })

  it('accepts the contribution id as well as the feed entry id', () => {
    const actions = sessionActions()
    const id = actions.addMarker(marker())

    actions.undo(id)

    expect(sessionState().markers).toHaveLength(0)
  })

  it('keeps the entry but drops its undo affordance, and logs the reversal as the human', () => {
    const actions = sessionActions()
    actions.addMarker(marker())
    const entryId = undoableEntryId()

    actions.undo(entryId)

    const state = sessionState()
    const original = state.activity.find((entry) => entry.id === entryId)
    expect(original).toBeDefined()
    expect(original?.undoable).not.toBe(true)
    expect(state.activity).toHaveLength(2)
    expect(state.activity[1]?.author).toBe('human')

    // A second undo of the same thing is a no-op rather than a second reversal line.
    actions.undo(entryId)
    expect(sessionState().activity).toHaveLength(2)
  })

  it('restores the previous report rather than deleting the slot', () => {
    const actions = sessionActions()
    actions.setReport(report({ title: 'human draft', author: 'human' }), 'human')
    actions.setReport(report({ title: 'agent draft' }), 'agent')
    const entryId = undoableEntryId()

    actions.undo(entryId)

    expect(sessionState().report?.title).toBe('human draft')
  })

  it('refuses to undo a human contribution', () => {
    const actions = sessionActions()
    const id = actions.addMarker(marker({ author: 'human' }))

    actions.undo(id)

    expect(sessionState().markers).toHaveLength(1)
  })

  it('undoes one hypothesis by id without taking its siblings', () => {
    const actions = sessionActions()
    const ids = actions.addHypotheses([hypothesis(), hypothesis({ text: 'a second explanation' })])

    actions.undo(ids[0] ?? '')

    expect(sessionState().hypotheses.map((item) => item.id)).toEqual([ids[1]])
  })
})

describe('a rejected marker survives', () => {
  it('flags rather than deletes, and restores', () => {
    const actions = sessionActions()
    const id = actions.addMarker(marker())

    actions.rejectMarker(id)
    expect(sessionState().markers).toHaveLength(1)
    expect(sessionState().markers[0]?.rejected).toBe(true)

    actions.restoreMarker(id)
    expect(sessionState().markers).toHaveLength(1)
    expect(sessionState().markers[0]?.rejected).toBe(false)
  })

  it('says nothing when there was nothing to change', () => {
    const actions = sessionActions()
    const id = actions.addMarker(marker())
    actions.rejectMarker(id)
    const count = sessionState().activity.length

    actions.rejectMarker(id)
    actions.rejectMarker('no-such-marker')
    actions.restoreMarker('no-such-marker')

    expect(sessionState().activity).toHaveLength(count)
  })

  it('keeps a rejected hypothesis visible too', () => {
    const actions = sessionActions()
    const ids = actions.addHypotheses([hypothesis()])

    actions.rejectHypothesis(ids[0] ?? '', 'human')

    expect(sessionState().hypotheses).toHaveLength(1)
    expect(sessionState().hypotheses[0]?.status).toBe('rejected')
  })
})

describe('nothing is mutated in place', () => {
  it('copies the arrays it is handed', () => {
    const actions = sessionActions()
    const checkpoints = [0, 20_000]
    const steps = [{ atMs: 20_000, result: false }]
    const evidence = [{ atMs: 1_000, note: 'first' }]

    actions.loadRecording(recording(), checkpoints)
    actions.setBisectTrace(steps)
    actions.addHypotheses([hypothesis({ evidence })])

    checkpoints.push(99_999)
    steps.push({ atMs: 40_000, result: true })
    evidence.push({ atMs: 2_000, note: 'sneaked in' })

    const state = sessionState()
    expect(state.checkpoints).toEqual([0, 20_000])
    expect(state.bisectTrace).toHaveLength(1)
    expect(state.hypotheses[0]?.evidence).toHaveLength(1)
  })

  it('publishes a new array each time, leaving the previous one intact', () => {
    const actions = sessionActions()
    actions.addMarker(marker())
    const markersBefore = sessionState().markers
    const activityBefore = sessionState().activity
    const entryBefore = activityBefore[0]

    actions.addMarker(marker({ timestamp: 30_000 }))
    actions.rejectMarker(markersBefore[0]?.id ?? '')

    // The arrays a component rendered from are still the arrays it rendered from.
    expect(markersBefore).toHaveLength(1)
    expect(markersBefore[0]?.rejected).toBeUndefined()
    expect(activityBefore).toHaveLength(1)
    expect(sessionState().markers).not.toBe(markersBefore)
    expect(sessionState().activity).not.toBe(activityBefore)
    expect(sessionState().activity[0]).toBe(entryBefore)
  })

  it('does not hand back a live task object from claimTask', () => {
    const actions = sessionActions()
    const id = actions.addTask('bisect the dropdown', 'human')
    const open = sessionState().tasks[0]

    const claimed = actions.claimTask(id)

    expect(open?.status).toBe('open')
    expect(claimed?.status).toBe('claimed')
    expect(claimed).not.toBe(open)
  })
})

describe('semantics that a later change would otherwise "simplify"', () => {
  it('hands a task to exactly one claimer', () => {
    const actions = sessionActions()
    const id = actions.addTask('find the empty dropdown', 'human')

    const first = actions.claimTask(id)
    const second = actions.claimTask(id)

    expect(first?.claimedAt).toBeTypeOf('number')
    expect(second).toBeNull()
    expect(actions.claimTask('no-such-task')).toBeNull()
    // The refused claim is not an event: nothing changed, so nothing is described.
    expect(sessionState().activity.filter((entry) => entry.description.startsWith('claimed'))).toHaveLength(1)
  })

  it('keeps the open question when a second one is asked', () => {
    const actions = sessionActions()
    const first = actions.openAsk({ question: 'Broken or empty?', choices: ['broken', 'empty'] })
    const second = actions.openAsk({ question: 'Something else entirely?', choices: ['yes', 'no'] })

    expect(second).toBe(first)
    expect(sessionState().pendingAsk?.question).toBe('Broken or empty?')
    expect(sessionState().activity).toHaveLength(1)
  })

  it('answers once, parks the structured answer, and makes the follow-up clear a no-op', () => {
    const actions = sessionActions()
    const id = actions.openAsk({ question: 'Broken or empty?', choices: ['broken', 'empty'] })

    actions.answerAsk(id, { choice: 'empty', markedTimestamp: 28_412 })
    actions.clearAsk()

    expect(sessionState().pendingAsk).toBeNull()
    expect(sessionState().activity).toHaveLength(2)
    expect(consumeAskAnswer(id)).toEqual({ choice: 'empty', markedTimestamp: 28_412 })
    // Read once: the gate collects it, and a stale copy would answer a later question.
    expect(consumeAskAnswer(id)).toBeNull()
  })

  it('ignores an answer to a question that is no longer open', () => {
    const actions = sessionActions()
    const id = actions.openAsk({ question: 'Broken or empty?', choices: ['broken', 'empty'] })
    actions.clearAsk()

    actions.answerAsk(id, { choice: 'empty', markedTimestamp: 28_412 })

    expect(sessionState().activity).toHaveLength(2)
    expect(consumeAskAnswer(id)).toBeNull()
  })

  it('never logs a human scrub, and coalesces repeated agent seeks', () => {
    const actions = sessionActions()
    actions.loadRecording(recording(), [])
    const baseline = sessionState().activity.length

    for (let atMs = 0; atMs < 500; atMs += 16) actions.setCurrentTime(atMs, 'human')
    expect(sessionState().activity).toHaveLength(baseline)
    expect(sessionState().currentTime).toBe(496)

    actions.setCurrentTime(10_000, 'agent')
    actions.setCurrentTime(20_000, 'agent')
    actions.setCurrentTime(28_412, 'agent')

    const seekEntries = sessionState().activity.filter((entry) => entry.description.startsWith('seeked'))
    expect(seekEntries).toHaveLength(1)
    expect(seekEntries[0]?.description).toContain('28.412s')
    expect(seekEntries[0]?.author).toBe('agent')
  })

  it('clamps the playhead into the recording', () => {
    const actions = sessionActions()
    actions.loadRecording(recording(30_000), [])

    actions.setCurrentTime(-5, 'human')
    expect(sessionState().currentTime).toBe(0)

    actions.setCurrentTime(99_999, 'human')
    expect(sessionState().currentTime).toBe(30_000)
  })

  it('replaces the bisect trace wholesale', () => {
    const actions = sessionActions()
    actions.setBisectTrace([{ atMs: 1_000, result: false }, { atMs: 2_000, result: true }])
    actions.setBisectTrace([{ atMs: 5_000, result: true }])

    expect(sessionState().bisectTrace).toEqual([{ atMs: 5_000, result: true }])
  })

  it('clears findings when a new recording arrives', () => {
    const actions = sessionActions()
    actions.loadRecording(recording(), [])
    actions.addMarker(marker())
    actions.setReport(report(), 'agent')

    actions.loadRecording(recording(12_000), [0])

    const state = sessionState()
    expect(state.markers).toHaveLength(0)
    expect(state.report).toBeNull()
    expect(state.currentTime).toBe(0)
    // One line, explaining the empty panels around it.
    expect(state.activity).toHaveLength(1)
    expect(state.activity[0]?.author).toBe('human')
  })

  it('resets to an empty session, feed included', () => {
    const actions = sessionActions()
    actions.loadRecording(recording(), [0])
    actions.addMarker(marker())

    actions.reset()

    const state = useSessionStore.getState()
    expect(state.activity).toEqual([])
    expect(state.markers).toEqual([])
    expect(state.recording).toBeNull()
    expect(state.checkpoints).toEqual([])
  })
})

describe('severityOf', () => {
  it('maps event kinds to the timeline colours', () => {
    expect(severityOf('consoleError')).toBe('error')
    expect(severityOf('failedRequest')).toBe('error')
    expect(severityOf('rageClick')).toBe('warn')
    expect(severityOf('click')).toBe('info')
  })
})
