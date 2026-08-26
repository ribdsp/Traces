import { create } from 'zustand'
import type {
  AskHumanVisual,
  AskHumanVisualAnswer,
  Author,
  BisectStep,
  Hypothesis,
  Marker,
  Recording,
  Report,
  SessionState,
  Severity,
  Task,
} from '@/types/domain'

/**
 * The single state store.
 *
 * Owner: Vicko. Shape frozen in types/domain.ts as the contract Faiq's components read.
 *
 * Why zustand rather than Context plus useReducer, since this comes up in review every time:
 * `execute()` inside a WebMCP tool **is not a React component**. The browser calls it from outside
 * the render tree, with no hooks available and no provider in scope. It needs imperative
 * `getState()` and `setState()`, which Context structurally cannot offer. That single constraint
 * decides the library.
 *
 * Two rules that the activity feed's correctness depends on entirely:
 *
 *   1. **Every mutation goes through an action, and every action takes `author`.** No component ever
 *      calls setState directly. Get this right and the feed is correct for free, including for code
 *      written by someone who never read this comment.
 *   2. **Actions return new objects.** Per-contribution undo needs the previous state intact, so
 *      never mutate an array or an entry in place.
 */

const initialState: SessionState = {
  recording: null,
  checkpoints: [],
  currentTime: 0,
  markers: [],
  hypotheses: [],
  tasks: [],
  activity: [],
  pendingAsk: null,
  bisectTrace: [],
  report: null,
}

export type SessionActions = {
  loadRecording: (recording: Recording, checkpoints: number[]) => void

  /** Moves the playhead. Called by the human scrubbing and by the `seek` tool. */
  setCurrentTime: (atMs: number, author: Author) => void

  addMarker: (marker: Omit<Marker, 'id'>) => string
  rejectMarker: (id: string) => void
  restoreMarker: (id: string) => void

  addHypotheses: (hypotheses: Omit<Hypothesis, 'id'>[]) => string[]
  promoteHypothesis: (id: string, author: Author) => void
  rejectHypothesis: (id: string, author: Author) => void

  addTask: (text: string, author: Author) => string
  claimTask: (id: string) => Task | null
  completeTask: (id: string) => void

  /** Opens the human-in-the-loop question. Resolved from the player, not from here. */
  openAsk: (ask: Omit<AskHumanVisual, 'id' | 'askedAt'>) => string
  answerAsk: (id: string, answer: AskHumanVisualAnswer) => void
  clearAsk: () => void

  /** Replaced wholesale on each bisect, so BisectTrace can animate from the first step. */
  setBisectTrace: (trace: BisectStep[]) => void

  setReport: (report: Report, author: Author) => void

  /**
   * Undo one agent contribution by id — a marker, a hypothesis, or the report. The human keeps a
   * veto over every individual thing the agent did, not just over the whole session.
   */
  undo: (id: string) => void

  reset: () => void
}

export type SessionStore = SessionState & SessionActions

const notImplemented = (action: string) => () => {
  throw new Error(`session store: ${action} not implemented`)
}

/**
 * TODO(vicko), Day 2. For each action, in this order:
 *   - build the new entry with a stable id (`crypto.randomUUID()`)
 *   - `set` with new arrays, never `push`
 *   - append one ActivityEntry describing it in past tense, carrying the same `author`
 *
 * `severityOf` and `describe` below are the two helpers worth extracting first — every action needs
 * them and duplicating the wording is how the feed ends up phrased three different ways.
 */
export const useSessionStore = create<SessionStore>(() => ({
  ...initialState,

  loadRecording: notImplemented('loadRecording'),
  setCurrentTime: notImplemented('setCurrentTime'),

  addMarker: notImplemented('addMarker'),
  rejectMarker: notImplemented('rejectMarker'),
  restoreMarker: notImplemented('restoreMarker'),

  addHypotheses: notImplemented('addHypotheses'),
  promoteHypothesis: notImplemented('promoteHypothesis'),
  rejectHypothesis: notImplemented('rejectHypothesis'),

  addTask: notImplemented('addTask'),
  claimTask: notImplemented('claimTask'),
  completeTask: notImplemented('completeTask'),

  openAsk: notImplemented('openAsk'),
  answerAsk: notImplemented('answerAsk'),
  clearAsk: notImplemented('clearAsk'),

  setBisectTrace: notImplemented('setBisectTrace'),
  setReport: notImplemented('setReport'),
  undo: notImplemented('undo'),
  reset: notImplemented('reset'),
}))

/**
 * The imperative handle for tool code.
 *
 * Tools import these two rather than the hook, which keeps the "no hooks outside React" rule
 * obvious at the call site instead of relying on everyone remembering it.
 */
export const sessionState = () => useSessionStore.getState()
export const sessionActions = () => useSessionStore.getState() as SessionActions

/** Marker severity for an event kind. Keeps the timeline's colours consistent across authors. */
export function severityOf(kind: string): Severity {
  if (kind === 'consoleError' || kind === 'failedRequest') return 'error'
  if (kind === 'consoleWarn' || kind === 'rageClick') return 'warn'
  return 'info'
}
