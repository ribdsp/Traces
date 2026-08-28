import { create } from 'zustand'
import type {
  ActivityEntry,
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
 * Shape frozen in types/domain.ts as the contract the components read.
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

// ---------------------------------------------------------------------------
// Feed wording
// ---------------------------------------------------------------------------

/**
 * Recording time as the feed says it, everywhere: "28.412s".
 *
 * Extracted because a feed that says "28.412s" on one line, "28412ms" on the next and "28.4s" on a
 * third reads as three different systems talking. Milliseconds are the wire format; this is the
 * human format, and the two never mix in a description.
 */
const timeLabel = (atMs: number): string => `${(atMs / 1000).toFixed(3)}s`

/** A feed line is one line. Labels, questions and titles get clipped rather than wrapping the panel. */
const FEED_TEXT_BUDGET = 60

const oneLine = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= FEED_TEXT_BUDGET ? flat : `${flat.slice(0, FEED_TEXT_BUDGET - 1)}…`
}

/**
 * The one place an ActivityEntry is built.
 *
 * Everything else in this file phrases its own sentence and hands it here, so the id, the clock and
 * the `undoable` rule are decided once. Two details worth stating out loud:
 *
 *   - `at` is **wall-clock** ms, never `currentTime`. Recording time and real time are different
 *     clocks; a feed that mixes them claims the human acted 28 seconds ago when they acted now.
 *   - `undoable` is only ever set on agent entries, because undo is the *human's* veto over the
 *     agent. A human entry with an undo button would be a delete button wearing a disguise.
 */
function describe(author: Author, description: string, undoable = false): ActivityEntry {
  return {
    id: crypto.randomUUID(),
    at: Date.now(),
    author,
    description,
    // Omitted rather than set to false: the type says "set for agent entries", so absent means no.
    ...(undoable && author === 'agent' ? { undoable: true } : {}),
  }
}

// ---------------------------------------------------------------------------
// Undo index
// ---------------------------------------------------------------------------

/**
 * What one undoable feed entry would reverse.
 *
 * `undo(id)` is called from the activity feed with an **ActivityEntry id**, and from code that holds
 * the contribution's own id (a marker id, a hypothesis id). Both have to work, so the entry id is
 * looked up here first and falls back to matching state by id — see `recordFor`.
 *
 * This lives module-level rather than in state because `SessionState` is a frozen contract and this
 * is bookkeeping, not something any component renders. It is cleared by `reset` and `loadRecording`
 * alongside the state it describes.
 */
type UndoRecord =
  | { kind: 'marker'; markerId: string }
  | { kind: 'hypotheses'; hypothesisIds: string[] }
  /** The report is a single slot with no id, so undo restores whatever stood there before. */
  | { kind: 'report'; previous: Report | null }

const undoIndex = new Map<string, UndoRecord>()

/**
 * Where a human's structured answer waits for the tool that asked.
 *
 * `answerAsk` clears `pendingAsk`, and that answer — a choice plus the timestamp the human clicked —
 * is the entire payload of `ask_human_visual`. Dropping it would leave the feed description as the
 * only copy, which is prose the agent would have to parse back into a timestamp. The store cannot
 * resolve the gate itself (`lib/webmcp/blocking` imports nothing from here, and the reverse would be
 * a cycle), so the answer is parked here for whoever holds the ticket. Read once, then it's gone.
 */
const askAnswers = new Map<string, AskHumanVisualAnswer>()

export function consumeAskAnswer(askId: string): AskHumanVisualAnswer | null {
  const answer = askAnswers.get(askId)
  if (answer === undefined) return null
  askAnswers.delete(askId)
  return answer
}

/** Fallback resolution: the caller passed the contribution's own id instead of the feed entry's. */
function recordFor(state: SessionState, id: string): UndoRecord | null {
  if (state.markers.some((marker) => marker.id === id)) return { kind: 'marker', markerId: id }
  if (state.hypotheses.some((hypothesis) => hypothesis.id === id)) {
    return { kind: 'hypotheses', hypothesisIds: [id] }
  }
  return null
}

/**
 * The last agent seek entry, so repeated seeks coalesce instead of stacking. See `setCurrentTime`.
 */
let lastAgentSeekEntryId: string | null = null

/** Two agent seeks closer together than this collapse into one line. */
const SEEK_COALESCE_MS = 1_500

export const useSessionStore = create<SessionStore>((set, get) => ({
  ...initialState,

  /**
   * A recording owns the clock every marker, hypothesis and report timestamp is expressed in, so
   * loading one clears the findings rather than carrying them over. A marker at 28.412s of a
   * different recording is not stale data, it is wrong data pointing at a real-looking moment.
   *
   * No `author` parameter: only a person loads a recording — there is no tool for it — so the entry
   * is the human's.
   */
  loadRecording: (recording, checkpoints) => {
    undoIndex.clear()
    lastAgentSeekEntryId = null

    set({
      ...initialState,
      recording,
      checkpoints: [...checkpoints],
      activity: [
        describe('human', `loaded recording "${oneLine(recording.label)}" (${timeLabel(recording.durationMs)})`),
      ],
    })
  },

  /**
   * Moving the playhead is the one visible change that does *not* always get a feed line.
   *
   * A human scrub fires on every pointer move, and playback fires on every animation frame; one
   * entry per call would bury the agent's actual contributions under a thousand "seeked to 12.316s"
   * lines within a second of playing the recording. Two decisions follow:
   *
   *   - **Human seeks are never logged.** The playhead is its own feedback — it is on screen, moving,
   *     under the hand that moved it — so a feed entry buys nothing and costs the whole feed.
   *   - **Agent seeks are logged, but coalesced.** `seek` is the agent visibly taking the wheel of
   *     someone else's UI, which is worth a line. Consecutive agent seeks within SEEK_COALESCE_MS
   *     replace that one line (with a new object, never in place) instead of appending another, so a
   *     tool that walks the timeline in a loop still reads as one action.
   */
  setCurrentTime: (atMs, author) => {
    set((state) => {
      // Clamp into the recording: a playhead off the end of the timeline renders as no playhead at
      // all, which looks like a broken player rather than a bad argument.
      const duration = state.recording?.durationMs
      const clamped = Math.max(0, duration === undefined ? atMs : Math.min(atMs, duration))
      if (clamped === state.currentTime) return {}
      if (author === 'human') return { currentTime: clamped }

      const description = `seeked to ${timeLabel(clamped)}`
      const last = state.activity[state.activity.length - 1]
      const coalescable =
        last !== undefined &&
        last.id === lastAgentSeekEntryId &&
        Date.now() - last.at < SEEK_COALESCE_MS

      if (last !== undefined && coalescable) {
        // A new object, as always — the entry the feed already rendered is left untouched.
        const merged: ActivityEntry = { ...last, at: Date.now(), description }
        return { currentTime: clamped, activity: [...state.activity.slice(0, -1), merged] }
      }

      const entry = describe('agent', description)
      lastAgentSeekEntryId = entry.id
      return { currentTime: clamped, activity: [...state.activity, entry] }
    })
  },

  addMarker: (marker) => {
    const created: Marker = { ...marker, id: crypto.randomUUID() }
    const entry = describe(
      marker.author,
      `marked ${timeLabel(marker.timestamp)} as ${marker.severity}: "${oneLine(marker.label)}"`,
      true,
    )
    if (entry.undoable) undoIndex.set(entry.id, { kind: 'marker', markerId: created.id })

    set((state) => ({
      markers: [...state.markers, created],
      activity: [...state.activity, entry],
    }))

    return created.id
  },

  /**
   * A rejected marker is kept and drawn faded, not removed: the human's veto is itself part of the
   * record, and `restoreMarker` has to have something to restore. Deleting is what `undo` does, and
   * the two are different acts — reject says "I looked at this and disagreed", undo says "this
   * should never have been here".
   *
   * No `author`: the veto belongs to the human by construction. The agent has no reject tool, and
   * giving it one would let it quietly retract findings a person is looking at.
   */
  rejectMarker: (id) => {
    set((state) => {
      const marker = state.markers.find((candidate) => candidate.id === id)
      // Unknown id, or already rejected: nothing changed, so nothing is described.
      if (!marker || marker.rejected) return {}

      return {
        markers: state.markers.map((candidate) =>
          candidate.id === id ? { ...candidate, rejected: true } : candidate,
        ),
        activity: [
          ...state.activity,
          describe('human', `rejected the marker "${oneLine(marker.label)}" at ${timeLabel(marker.timestamp)}`),
        ],
      }
    })
  },

  restoreMarker: (id) => {
    set((state) => {
      const marker = state.markers.find((candidate) => candidate.id === id)
      if (!marker || !marker.rejected) return {}

      return {
        markers: state.markers.map((candidate) =>
          candidate.id === id ? { ...candidate, rejected: false } : candidate,
        ),
        activity: [
          ...state.activity,
          describe('human', `restored the marker "${oneLine(marker.label)}" at ${timeLabel(marker.timestamp)}`),
        ],
      }
    })
  },

  /**
   * Hypotheses arrive as a ranked set from one `propose_hypotheses` call, so they get one feed line
   * and one undo: the contribution is the set, and the cards are its parts. Vetoing a single card is
   * `rejectHypothesis`, which keeps it visible — the record of what was considered is worth more
   * than a tidy list. `undo` still accepts a single hypothesis id for callers that hold one.
   */
  addHypotheses: (hypotheses) => {
    const first = hypotheses[0]
    if (first === undefined) return []

    const created: Hypothesis[] = hypotheses.map((hypothesis) => ({
      ...hypothesis,
      // Evidence is copied, not aliased: the caller's array must not become live state.
      evidence: [...hypothesis.evidence],
      id: crypto.randomUUID(),
    }))

    // A batch is authored by whoever made the call; ranking is the agent's, so element 0 speaks for it.
    const entry = describe(
      first.author,
      created.length === 1
        ? `proposed a hypothesis: "${oneLine(first.text)}"`
        : `proposed ${created.length} hypotheses`,
      true,
    )
    if (entry.undoable) {
      undoIndex.set(entry.id, { kind: 'hypotheses', hypothesisIds: created.map((item) => item.id) })
    }

    set((state) => ({
      hypotheses: [...state.hypotheses, ...created],
      activity: [...state.activity, entry],
    }))

    return created.map((item) => item.id)
  },

  promoteHypothesis: (id, author) => {
    set((state) => {
      const index = state.hypotheses.findIndex((candidate) => candidate.id === id)
      const hypothesis = state.hypotheses[index]
      if (hypothesis === undefined || hypothesis.status === 'promoted') return {}

      return {
        hypotheses: state.hypotheses.map((candidate) =>
          candidate.id === id ? { ...candidate, status: 'promoted' as const } : candidate,
        ),
        // Position, not text: the cards are numbered 1..n on screen and that is what the human said.
        activity: [...state.activity, describe(author, `promoted hypothesis ${index + 1}`)],
      }
    })
  },

  rejectHypothesis: (id, author) => {
    set((state) => {
      const index = state.hypotheses.findIndex((candidate) => candidate.id === id)
      const hypothesis = state.hypotheses[index]
      if (hypothesis === undefined || hypothesis.status === 'rejected') return {}

      return {
        // Kept, with a rejected status, so the card fades rather than vanishing.
        hypotheses: state.hypotheses.map((candidate) =>
          candidate.id === id ? { ...candidate, status: 'rejected' as const } : candidate,
        ),
        activity: [...state.activity, describe(author, `rejected hypothesis ${index + 1}`)],
      }
    })
  },

  addTask: (text, author) => {
    const created: Task = { id: crypto.randomUUID(), text, status: 'open', author }

    set((state) => ({
      tasks: [...state.tasks, created],
      activity: [...state.activity, describe(author, `added task "${oneLine(text)}"`)],
    }))

    return created.id
  },

  /**
   * Hand a task over, exactly once.
   *
   * `claim_next_task` is a blocking tool an agent retries, and a host that reissues a call can send
   * the same claim twice. So the status check and the write happen in one synchronous action — no
   * await between the `get` and the `set` — and a second claim returns null rather than handing two
   * callers the same work. Null also covers "unknown id" and "already done"; the caller's job is to
   * look for another task, not to guess which of those it hit.
   *
   * `author` stays whoever *wrote* the task. The feed entry is the agent's, because claiming is the
   * agent's act.
   */
  claimTask: (id) => {
    const task = get().tasks.find((candidate) => candidate.id === id)
    if (task === undefined || task.status !== 'open') return null

    const claimed: Task = { ...task, status: 'claimed', claimedAt: Date.now() }

    set((state) => ({
      tasks: state.tasks.map((candidate) => (candidate.id === id ? claimed : candidate)),
      activity: [...state.activity, describe('agent', `claimed task "${oneLine(task.text)}"`)],
    }))

    return claimed
  },

  completeTask: (id) => {
    set((state) => {
      const task = state.tasks.find((candidate) => candidate.id === id)
      if (task === undefined || task.status === 'done') return {}

      return {
        tasks: state.tasks.map((candidate) =>
          candidate.id === id ? { ...candidate, status: 'done' as const } : candidate,
        ),
        activity: [...state.activity, describe('agent', `completed task "${oneLine(task.text)}"`)],
      }
    })
  },

  /**
   * Open the question, first asker wins.
   *
   * `pendingAsk` is a single slot and this action refuses to overwrite it: it keeps the open question
   * and returns **that** question's id. A second question would replace a prompt the human may be
   * halfway through answering, and the first tool call — still awaiting its gate — would then wait on
   * an answer that can never arrive. The retry path exists for exactly this (`retryGate` with the
   * ticket); a caller that gets back an id it did not expect should attach to the open question
   * rather than start a new one. Nothing changed, so nothing is added to the feed.
   */
  openAsk: (ask) => {
    const open = get().pendingAsk
    if (open !== null) return open.id

    const created: AskHumanVisual = {
      ...ask,
      choices: [...ask.choices],
      id: crypto.randomUUID(),
      askedAt: Date.now(),
    }

    set((state) => ({
      pendingAsk: created,
      activity: [...state.activity, describe('agent', `asked the human: "${oneLine(ask.question)}"`)],
    }))

    return created.id
  },

  /**
   * Resolve the open question and close the slot.
   *
   * The gate itself is resolved by the caller through `answerGate(ticket, …)` — the store does not
   * import `lib/webmcp`, and would create a cycle if it did — so the answer is parked in
   * `consumeAskAnswer` below for whoever holds the ticket. Answering clears `pendingAsk` here,
   * which makes the following `clearAsk()` in the overlay a no-op rather than a second feed line.
   *
   * A mismatched or stale id is ignored: an overlay click that lands after the question was cleared
   * is a human being slow, not an answer to whatever is open now.
   */
  answerAsk: (id, answer) => {
    set((state) => {
      const open = state.pendingAsk
      if (open === null || open.id !== id) return {}

      askAnswers.set(id, { ...answer })

      const note = answer.note === undefined ? '' : ` — "${oneLine(answer.note)}"`
      return {
        pendingAsk: null,
        activity: [
          ...state.activity,
          describe(
            'human',
            `answered "${oneLine(answer.choice)}" at ${timeLabel(answer.markedTimestamp)}${note}`,
          ),
        ],
      }
    })
  },

  /**
   * Close the question without an answer. Idempotent, so the overlay's answer-then-clear pair adds
   * one line rather than two. A dismissal is logged, because a gate that is now going to time out is
   * something the human should be able to see they caused.
   */
  clearAsk: () => {
    set((state) => {
      const open = state.pendingAsk
      if (open === null) return {}

      return {
        pendingAsk: null,
        activity: [
          ...state.activity,
          describe('human', `dismissed the question "${oneLine(open.question)}"`),
        ],
      }
    })
  },

  /**
   * Replaced wholesale, never appended to: `BisectTrace` animates from the first step, so a trace
   * that grows would replay the previous search each time a probe landed. An empty trace clears the
   * visualisation and is not worth a feed line — the line belongs to the search, not to tidying up.
   */
  setBisectTrace: (trace) => {
    const steps = trace.map((step) => ({ ...step }))
    if (steps.length === 0) {
      set({ bisectTrace: [] })
      return
    }

    const firstTrue = steps.reduce<number | null>(
      (earliest, step) =>
        step.result && (earliest === null || step.atMs < earliest) ? step.atMs : earliest,
      null,
    )
    const description =
      firstTrue === null
        ? `bisected ${steps.length} probes without finding a transition`
        : `bisected ${steps.length} probes, narrowing to ${timeLabel(firstTrue)}`

    set((state) => ({
      bisectTrace: steps,
      // Not undoable: a trace is the visible record of a search, replaced by the next one anyway.
      activity: [...state.activity, describe('agent', description)],
    }))
  },

  setReport: (report, author) => {
    const entry = describe(
      author,
      author === 'agent'
        ? `drafted a report: "${oneLine(report.title)}"`
        : `edited the report: "${oneLine(report.title)}"`,
      true,
    )

    // Undo restores the draft that stood here before, which is often null. Snapshotting it is what
    // makes undoing an agent's report a revert rather than a delete.
    if (entry.undoable) undoIndex.set(entry.id, { kind: 'report', previous: get().report })

    set((state) => ({
      report: { ...report, steps: [...report.steps], evidence: [...report.evidence] },
      activity: [...state.activity, entry],
    }))
  },

  /**
   * Reverse exactly one agent contribution.
   *
   * `id` is either the feed entry's id (what the activity feed's undo button passes) or the
   * contribution's own id (what tool code holds). Only agent-authored contributions are undoable:
   * this is the human's veto, and it deliberately has no counterpart for the human's own work.
   *
   * The feed entry that offered the undo is kept and loses its button — the fact that something was
   * proposed and retracted is part of the record. The reversal appends its own line, authored by the
   * human, so the feed reads as two events because two things happened.
   */
  undo: (id) => {
    set((state) => {
      const record = undoIndex.get(id) ?? recordFor(state, id)
      if (!record) return {}

      const reversal = ((): (Partial<SessionState> & { description: string }) | null => {
        if (record.kind === 'marker') {
          const marker = state.markers.find((candidate) => candidate.id === record.markerId)
          if (marker === undefined || marker.author !== 'agent') return null
          return {
            markers: state.markers.filter((candidate) => candidate.id !== record.markerId),
            description: `undid marker "${oneLine(marker.label)}" at ${timeLabel(marker.timestamp)}`,
          }
        }

        if (record.kind === 'hypotheses') {
          const doomed = state.hypotheses.filter(
            (candidate) => record.hypothesisIds.includes(candidate.id) && candidate.author === 'agent',
          )
          const first = doomed[0]
          if (first === undefined) return null
          const doomedIds = new Set(doomed.map((item) => item.id))
          return {
            hypotheses: state.hypotheses.filter((candidate) => !doomedIds.has(candidate.id)),
            description:
              doomed.length === 1
                ? `undid hypothesis "${oneLine(first.text)}"`
                : `undid ${doomed.length} proposed hypotheses`,
          }
        }

        if (state.report === null || state.report.author !== 'agent') return null
        return {
          report: record.previous,
          description:
            record.previous === null
              ? 'undid the report draft'
              : 'undid the report draft, restoring the previous one',
        }
      })()

      if (reversal === null) return {}
      const { description, ...next } = reversal

      return {
        ...next,
        activity: [
          // The entry keeps its place; only the affordance goes, since there is nothing left to undo.
          ...state.activity.map((entry) =>
            entry.id === id && entry.undoable ? { ...entry, undoable: false } : entry,
          ),
          describe('human', description),
        ],
      }
    })

    undoIndex.delete(id)
  },

  /**
   * Back to an empty session. Not logged: the feed is part of what reset clears, and a lone "reset
   * the session" line in an otherwise empty feed describes the wipe rather than the session.
   */
  reset: () => {
    undoIndex.clear()
    askAnswers.clear()
    lastAgentSeekEntryId = null
    set({ ...initialState })
  },
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
