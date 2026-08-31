/**
 * The frozen interface contract.
 *
 * Everything in this file was agreed on Day 1 and is what lets several people work in parallel:
 * `lib/` produces these shapes, `lib/webmcp/` serialises them, `components/` renders them. Nobody
 * has to read anybody else's implementation.
 *
 * If you need a new type, raise it rather than editing — this is the one file every area touches,
 * so it's the one file where a silent change costs someone an afternoon.
 *
 * Every JSON key here is camelCase, because these shapes go out over the wire to a model verbatim.
 */

// ---------------------------------------------------------------------------
// Authorship
// ---------------------------------------------------------------------------

/**
 * Who created a piece of state. Carried by every mutation, without exception.
 *
 * This is not bookkeeping — it is the evidence for the challenge requirement that the agent has an
 * identity of its own, separate from the human's actions. The activity feed, the per-contribution
 * accept/reject/undo controls, and the colour coding all read this one field.
 */
export type Author = 'human' | 'agent'

export type Severity = 'info' | 'warn' | 'error'

// ---------------------------------------------------------------------------
// Recordings
// ---------------------------------------------------------------------------

/**
 * The structural minimum of an rrweb event.
 *
 * Deliberately not imported from rrweb: `lib/` stays free of that dependency so its tests run in
 * milliseconds without a browser. `load-recording.ts` validates incoming JSON against this shape
 * and rejects anything else — a malformed recording should fail at load, not halfway through a
 * bisect.
 */
export type RrwebEvent = {
  /** rrweb event type. 2 = FullSnapshot, 3 = IncrementalSnapshot. See lib/replay/checkpoint-index. */
  type: number
  /** Absolute epoch milliseconds, as rrweb records them. */
  timestamp: number
  data: unknown
}

export type Recording = {
  /** Slug matching the file name in public/recordings, e.g. `empty-province`. */
  id: string
  /** Human-readable, shown in the picker. */
  label: string
  events: RrwebEvent[]
  /** Absolute epoch ms of the first event. All tool-facing times are relative to this. */
  startedAt: number
  /** Length in ms. Every timestamp an agent sees is 0..durationMs. */
  durationMs: number
  meta: RecordingMeta
}

/** What `read_session_meta` returns. Small on purpose: it is usually the agent's first call. */
export type RecordingMeta = {
  recordingId: string
  durationMs: number
  eventCount: number
  /** As recorded by rrweb's meta event, not sniffed at replay time. */
  viewport: { width: number; height: number }
  userAgent: string
  /** Pages visited, in order, with the time each was entered. */
  navigations: { atMs: number; url: string }[]
  counts: { clicks: number; inputs: number; consoleErrors: number; failedRequests: number }
}

// ---------------------------------------------------------------------------
// Event digest
// ---------------------------------------------------------------------------

export type DigestEventKind =
  | 'click'
  | 'input'
  | 'navigation'
  | 'consoleError'
  | 'consoleWarn'
  | 'failedRequest'
  | 'rageClick'

/**
 * One interesting thing that happened, as `list_events` reports it.
 *
 * "Interesting" is doing real work here: a 47-second recording holds thousands of mutation events
 * and an agent asked to read all of them learns nothing. See lib/replay/event-digest.ts.
 */
export type DigestEvent = {
  atMs: number
  kind: DigestEventKind
  /** One line, already truncated. Never raw HTML. */
  summary: string
  /** Present when the event is attributable to an element. */
  selector?: string
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

/**
 * The agent-legible rendering of a DOM subtree: newline-separated, indented, budgeted.
 *
 * A string rather than a tree, because it is read by a language model, and every wrapper object we
 * add costs tokens that buy the model nothing. Budget and format: docs/agent-legible-dom.md.
 */
export type CompressedDom = string

export type CompressedDomResult = {
  atMs: number
  dom: CompressedDom
  lineCount: number
  charCount: number
  /** True when the budget clipped the output. The response tells the agent to narrow its scope. */
  truncated: boolean
  /** Raw character count of the source subtree, for the compression-ratio claim. */
  sourceCharCount: number
}

export type DomDiffChange = {
  kind: 'added' | 'removed' | 'attributeChanged' | 'textChanged'
  selector: string
  /** Present for attributeChanged and textChanged. Both sides truncated. */
  before?: string
  after?: string
}

export type DomDiffResult = {
  fromMs: number
  toMs: number
  changes: DomDiffChange[]
  truncated: boolean
}

export type LayoutBox = {
  selector: string
  x: number
  y: number
  width: number
  height: number
  /** Computed, not inline: what actually applied at that moment. */
  visibility: 'visible' | 'hidden'
  display: string
  zIndex: string
}

export type LayoutResult = {
  atMs: number
  boxes: LayoutBox[]
  /**
   * Elements whose boxes intersect while sitting at different z-indices — the cheap mechanical
   * answer to "is something covering the button", which is otherwise a question only eyes can
   * settle.
   */
  overlaps: { above: string; below: string; overlapArea: number }[]
}

// ---------------------------------------------------------------------------
// Bisect
// ---------------------------------------------------------------------------

/**
 * The closed set of things an agent may ask about an element.
 *
 * This is the security boundary of the whole project. A predicate is a structured object that our
 * own code evaluates against a real Element; it is never a string we run. There is deliberately no
 * `jsExpression` variant, and a test greps the source for `eval(` and `new Function` and fails the
 * build. Adding a capability means adding a variant here plus its evaluator — never an escape
 * hatch. See docs/tools.md#predicates and docs/threat-model.md.
 */
export type Predicate =
  | {
      kind: 'propertyEquals'
      property: 'disabled' | 'checked' | 'readOnly' | 'value'
      equals: string | boolean
    }
  | { kind: 'attributeExists'; attribute: string }
  | { kind: 'attributeEquals'; attribute: string; equals: string }
  | { kind: 'optionCount'; equals: number }
  | { kind: 'visible'; equals: boolean }
  | { kind: 'textContains'; text: string }
  | { kind: 'exists'; equals: boolean }

export type PredicateKind = Predicate['kind']

/** One probe of the binary search. `BisectTrace` animates these in order. */
export type BisectStep = {
  atMs: number
  result: boolean
  /**
   * The element wasn't in the document at this point in time. Evaluates as false, but the agent
   * needs to know the difference between "false" and "there was nothing to ask about" — otherwise
   * it reports a state change that was really an element appearing.
   */
  elementMissing?: boolean
}

export type BisectResult = {
  /** First time the predicate held, or null if it never did within [from, to]. */
  firstTrue: number | null
  /** Last time it did not hold. */
  lastFalse: number | null
  iterations: number
  elapsedMs: number
  precisionMs: number
  /**
   * The predicate already held at `from`, so `firstTrue` is a floor, not a transition. Without this
   * flag an agent confidently reports the start of the window as the moment the bug appeared.
   */
  alreadyTrueAtStart?: boolean
  trace: BisectStep[]
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export type Marker = {
  id: string
  timestamp: number
  label: string
  severity: Severity
  author: Author
  /** Set when a human rejects an agent's marker. Kept, not deleted, so undo works. */
  rejected?: boolean
}

export type HypothesisStatus = 'proposed' | 'promoted' | 'rejected'

export type Hypothesis = {
  id: string
  text: string
  /** 0..1, as claimed by whoever proposed it. Displayed, never used for arithmetic. */
  confidence: number
  /** Marker ids and timestamps. Clicking a hypothesis highlights all of these at once. */
  evidence: { markerId?: string; atMs: number; note: string }[]
  status: HypothesisStatus
  author: Author
}

export type TaskStatus = 'open' | 'claimed' | 'done'

/** A unit of work a human drops into the agent lane. `claim_next_task` hands one over. */
export type Task = {
  id: string
  text: string
  status: TaskStatus
  author: Author
  claimedAt?: number
}

export type ActivityEntry = {
  id: string
  /** Wall-clock ms, not recording time. */
  at: number
  author: Author
  /** Past tense, one line: "marked 28.412s as error", "promoted hypothesis 2". */
  description: string
  /** Set for agent entries so a human can undo exactly this one thing. */
  undoable?: boolean
}

export type ReportStep = {
  text: string
  /** Recording time this step was reconstructed from. */
  atMs?: number
  /**
   * False when no recorded event supports the step. Rendered as "unverified" rather than dropped:
   * a report that quietly omits a step reads as complete when it isn't.
   */
  verified: boolean
}

export type Report = {
  title: string
  summary: string
  steps: ReportStep[]
  expected: string
  actual: string
  rootCause: string
  evidence: { atMs: number; note: string }[]
  author: Author
}

// ---------------------------------------------------------------------------
// Human-in-the-loop
// ---------------------------------------------------------------------------

/**
 * A question the agent cannot answer for itself, waiting on a person.
 *
 * The direction of information is the point: the agent declares that it cannot see rendered output
 * and recruits the human as a sensor. The answer comes back structured — a choice plus a
 * timestamp — not as prose the agent then has to interpret.
 */
export type AskHumanVisual = {
  id: string
  question: string
  choices: string[]
  /** The agent's suggested place to look. The human is free to mark elsewhere. */
  hintAtMs?: number
  askedAt: number
}

export type AskHumanVisualAnswer = {
  choice: string
  /** Where the human clicked on the player. The precise part of the answer. */
  markedTimestamp: number
  note?: string
}

/**
 * The result of anything that waits on a human.
 *
 * A blocking tool must never leave the model's call unresolved: hosts differ in how long they
 * tolerate a pending tool, and an unresolved promise looks to the agent like a broken page. So
 * every gate resolves either way, and `pending` hands back a ticket the agent retries with.
 * See docs/tools.md#blocking-tools.
 */
export type GateResult<T> =
  | { status: 'answered'; value: T }
  | { status: 'pending'; ticket: string }

export type Gate<T> = {
  promise: Promise<GateResult<T>>
  resolve: (value: T) => void
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * The single state store.
 *
 * Read by components, written only through actions, and every action carries `author`.
 * Actions return new objects — per-contribution undo needs the previous state intact.
 */
export type SessionState = {
  recording: Recording | null
  /** Timestamps of full snapshots, so a bisect probe replays from the nearest one, not from zero. */
  checkpoints: number[]
  currentTime: number
  markers: Marker[]
  hypotheses: Hypothesis[]
  tasks: Task[]
  activity: ActivityEntry[]
  pendingAsk: AskHumanVisual | null
  bisectTrace: BisectStep[]
  report: Report | null
}
