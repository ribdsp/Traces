# Tool reference

Traces registers **16 WebMCP tools** on `document.modelContext`. This document is the contract: what
each tool takes, what it returns, and the rules an agent needs to know to use it correctly.

Every tool returns `{ content: [{ type: "text", text: ... }] }`. The WebMCP spec currently defines
only the `"text"` content type — an `"image"` type is still an open question — so everything below
describes what goes into that `text` field. Structured payloads are serialized JSON with
**camelCase** keys; human-readable payloads are compact plain text.

Two of these tools have no equivalent that we could find anywhere else in the WebMCP ecosystem:
**`bisect`** (§4) and **`ask_human_visual`** (§12). They are the reason this project exists.

---

## Tools at a glance

| # | Tool | Kind | Purpose |
|---|---|---|---|
| 1 | `read_session_meta` | read | duration, event count, viewport, UA, routes |
| 2 | `list_events` | read | only the interesting events, filtered |
| 3 | `find_element` | search | locate an element and its lifetime in the recording |
| 4 | **`bisect`** | **search over time** | **binary search across the replay timeline** |
| 5 | `read_dom_at` | read | agent-legible DOM at a single instant |
| 6 | `diff_dom` | read | what changed between two instants |
| 7 | `read_console` | read | console output in a time window |
| 8 | `read_network` | read | requests, statuses, summarized bodies |
| 9 | `measure_layout` | read | geometry, visibility, occlusion — visual bugs without pixels |
| 10 | `seek` | **UI effect** | moves the human's playhead |
| 11 | `annotate` | write | a permanent, agent-authored timeline marker |
| 12 | **`ask_human_visual`** | **blocking** | the human answers **and marks a moment** |
| 13 | `propose_hypotheses` | **blocking** | ranked hypothesis cards the human promotes or rejects |
| 14 | `propose_report` | **blocking** | a bug report draft the human edits and approves |
| 15 | `claim_next_task` | **blocking** | pull the next task from the agent lane |
| 16 | `snapshot_finding` | write | save a finding |

**Blocking** means exactly what it says: `execute()` does not resolve until a person acts. The
agent's own loop waits. See [§Blocking tools](#blocking-tools) for the timeout and retry contract.

---

## Read and search tools

### 1. `read_session_meta()`

```
input:  {}
output: { durationMs, eventCount, viewport: { w, h }, userAgent, routes: string[],
          consoleErrorCount, failedRequestCount }
```

Usually an agent's first call. Deliberately generous, so the agent doesn't have to guess what to
probe next.

### 2. `list_events({ types?, from?, to? })`

```
input:  { types?: ("click"|"input"|"navigation"|"console"|"error"|"network-fail")[],
          from?: number, to?: number }
output: { events: [{ timestampMs, type, summary }], totalMatched, truncated }
```

**Never returns the full event stream.** A 47-second recording holds a few hundred events; returning
them would flood the agent's context for no benefit. Hard cap of 40 entries; past that the response
is truncated, `truncated: true` is set, and the agent is told to narrow its range.

### 3. `find_element({ text?, role?, selector? })`

```
input:  { text?: string, role?: string, selector?: string }   // at least one
output: { matches: [{ selector, textSnippet, firstSeenMs, lastSeenMs }] }
```

At most 5 matches. The returned selector is what the agent will feed to `bisect`, so it must be
stable across the whole recording — not an `nth-child` index that shifts as the DOM mutates.

### 4. `bisect({ selector, predicate, from, to, precisionMs? })`

The tool this project is built around.

```
input:  { selector: string, predicate: Predicate,
          from: number, to: number, precisionMs?: number }   // default 250
output: { firstTrue: number|null, lastFalse: number|null,
          iterations: number, elapsedMs: number, precisionMs: number,
          alreadyTrueAtStart?: boolean,
          trace: [{ atMs, result, elementMissing? }] }
```

The agent sends a **predicate**. The page runs a binary search: it replays to a midpoint, evaluates
the predicate against the reconstructed DOM, and repeats. About six iterations gets 250 ms precision
on a 47-second recording.

This is the part that cannot be a REST endpoint. The agent is not fetching data — it is asking the
page to *run a computation over time* that only a live replay engine can perform.

**Contract details an agent needs:**

- The predicate is assumed **monotonic** within `[from, to]` — `false` then `true`, once. If it flips
  more than once, you get *one* transition point, not all of them.
- Already true at `from` → `{ firstTrue: from, alreadyTrueAtStart: true }`.
- Never true by `to` → `{ firstTrue: null }`.
- If the element does not exist at a probed instant, the predicate evaluates `false` **and** that
  step carries `elementMissing: true`. This distinction matters: "the button is not disabled" and
  "the button does not exist yet" are different findings, and conflating them produces confidently
  wrong conclusions.
- `precisionMs` in the response is the precision actually achieved, which may be coarser than
  requested if the recording is long. Read it rather than assuming.

`trace` is not decoration — the UI animates it, which is how a human watches the playhead jump six
times and understands what the agent just did.

Predicate grammar: [§Predicates](#predicates).

### 5. `read_dom_at({ timestamp, scope? })`

```
input:  { timestamp: number, scope?: string }   // scope is a container selector
output: plain text — the agent-legible DOM
```

```
form#checkout [visible]
  input[name=email] value="ana@..." [valid]
  input[name=card] value="" [invalid] aria-invalid=true
  select[name=province] [empty options: 0]
  button[type=submit] "Pay" [DISABLED]
  div.error "Province is required" [visible]
```

Six lines, not 800 KB. The rules that produce this — and the hard budget of 60 lines / 1,200
characters, enforced by a test — are in
[agent-legible-dom.md](agent-legible-dom.md).

### 6. `diff_dom({ from, to, scope? })`

```
output: { added: string[], removed: string[],
          changed: [{ selector, attribute, before, after }] }
```

Capped at 30 entries total.

### 7. `read_console({ from, to })`

```
output: { entries: [{ timestampMs, level, message }] }   // message truncated to 200 chars
```

### 8. `read_network({ from, to, filter? })`

```
input:  { from, to, filter?: string }   // filter is a URL substring
output: { requests: [{ timestampMs, method, url, status, durationMs, bodySummary }] }
```

`bodySummary` is a summary, never a raw body: an array becomes `"array, 0 items"`, an object becomes
its key list. Response bodies are both large and likely to contain personal data — two independent
reasons not to forward them.

### 9. `measure_layout({ selector, timestamp })`

```
output: { x, y, width, height, visible, occludedBy: string|null, insideViewport }
```

This is how Traces catches visual bugs **without pixels** — for instance a button that is present,
enabled, and simply covered by another element, so clicks never land.

---

## Write and UI tools

### 10. `seek({ timestamp, play? })`

```
input:  { timestamp: number, play?: number }   // play = milliseconds to play for
output: { ok: true, at: number }
```

The only tool whose effect is purely on human attention. The agent is not retrieving anything — it
is pointing at evidence and saying *look here*.

### 11. `annotate({ timestamp, label, severity })`

```
input:  { timestamp: number, label: string, severity: "low"|"medium"|"high" }
output: { id, ok: true }
```

Stored with `author: "agent"`, rendered in the agent's colour, individually undoable by the human.

### 16. `snapshot_finding({ name })`

```
output: { id, ok: true }
```

---

## Blocking tools

Four tools do not resolve until a person acts. This is what makes the human a tool inside the
agent's loop rather than a spectator watching it finish.

Because a tool call cannot hang forever, each blocking tool follows the same contract:

```
output: { status: "answered", ...payload }
     |  { status: "pending", ticket: string }
```

If the human hasn't acted before the internal timeout, the tool **returns** `pending` with a ticket
instead of leaving the call unresolved. The agent calls the same tool again with that ticket to
collect the answer once it exists. Agents should treat `pending` as "the human is still looking at
it", not as failure — and should say so to the user rather than retrying in a tight loop.

### 12. `ask_human_visual({ question, expects, choices? })`

```
input:  { question: string,
          expects: "choice" | "timestamp" | "timestamp+choice",
          choices?: string[] }
output: { status: "answered", choice?: string, markedTimestamp?: number }
     |  { status: "pending", ticket }
```

The agent cannot see rendered output. When a question genuinely requires eyes — *does this dropdown
look broken, or does it look normal but empty?* — it asks the human, and the human answers by
**clicking on the player** at the relevant moment. The answer comes back as structured data
(`{ choice, markedTimestamp }`), not prose.

**The human is the eyes. The agent is the reasoner.** That is the inverse of an agent taking a
screenshot and guessing, and it is a better fit for what each party is actually good at.

Use this for perceptual questions only. Anything answerable from state belongs in `read_dom_at`,
`measure_layout`, or `bisect`.

### 13. `propose_hypotheses({ hypotheses })`

```
input:  { hypotheses: [{ text, confidence: number,
                         evidence: [{ timestampMs, kind, note }] }] }
output: { status: "answered", promoted: string[], rejected: string[] }
     |  { status: "pending", ticket }
```

At most 5. Confidences are normalized by the page if they don't sum to 1. Every hypothesis must
carry evidence; clicking one in the UI highlights all of its evidence across the timeline at once.

### 14. `propose_report({ title, steps, evidence, rootCause, domSnippet? })`

```
input:  { title: string, steps: string[], evidence: number[],
          rootCause: string, domSnippet?: string }
output: { status: "answered", approved: boolean, finalText?: string }
     |  { status: "pending", ticket }
```

**`steps` are validated, not trusted.** Each step must map to a real event in the recording; steps
with no supporting event are flagged "unverified" in the UI before the human approves. This is what
makes "reproduction steps reconstructed from recorded events" a property of the system rather than a
claim about the model.

### 15. `claim_next_task()`

```
output: { status: "answered", taskId, text } | { status: "pending", ticket }
```

Pulls the next task a human dropped into the agent lane.

---

## Predicates

Predicates are a **closed, validated set of structured objects**. Traces never evaluates a string
from the model — no `eval`, no `new Function`, no interpolated expressions. A test greps the source
and fails the build if either appears.

```ts
type Predicate =
  | { kind: 'propertyEquals';  property: 'disabled'|'checked'|'readOnly'|'value'
                               equals: string | boolean }
  | { kind: 'attributeExists'; attribute: string }
  | { kind: 'attributeEquals'; attribute: string; equals: string }
  | { kind: 'optionCount';     equals: number }
  | { kind: 'visible';         equals: boolean }
  | { kind: 'textContains';    text: string }
  | { kind: 'exists';          equals: boolean }
```

Validation rules:

| Field | Rule | On violation |
|---|---|---|
| `kind` | must be one of the seven above | `Unsupported predicate kind 'x'. Supported: ...` |
| `property` | closed list, as typed | rejected with the list |
| `attribute` | `^[a-zA-Z-]{1,30}$` | rejected |
| `text` | ≤ 100 characters | rejected |
| `selector` | must parse as a valid selector, checked before the search starts | rejected up front, not thrown on iteration 3 |

Errors come back as readable tool errors, not exceptions — an agent that gets
`Unsupported predicate kind 'jsExpression'. Supported: propertyEquals, attributeExists, ...` will
correct itself on the next call.

Security is the first reason for this design, but not the only one: **models are far more reliable
at filling in a schema than at composing a JavaScript expression.** The closed set makes `bisect`
work on the first attempt more often than a string-based API would.

Examples:

```js
// when did the pay button become disabled?
{ selector: "#checkout button[type=submit]",
  predicate: { kind: "propertyEquals", property: "disabled", equals: true } }

// when did the province dropdown end up with no options?
{ selector: "select[name=province]",
  predicate: { kind: "optionCount", equals: 0 } }

// when did the error message first appear?
{ selector: "#checkout .error",
  predicate: { kind: "exists", equals: true } }
```

---

## Error behaviour

Tools that need a loaded recording stay registered at all times, but return a readable error when
there isn't one:

```
No recording loaded. Ask the human to drop a recording file, or pick one of the samples.
```

An agent handed that sentence will relay it to the user, which is more useful than a tool that
appears and disappears from the surface depending on page state.
