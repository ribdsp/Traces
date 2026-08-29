# Tool reference

Traces registers **16 WebMCP tools** on `document.modelContext`. This document is the contract: what
each tool takes, what it returns, and the rules an agent needs to know to use it correctly.

Every tool returns `{ content: [{ type: "text", text: ... }] }`. The WebMCP spec currently defines
only the `"text"` content type — an `"image"` type is still an open question — so everything below
describes what goes into that `text` field. Structured payloads are serialized JSON with
**camelCase** keys, indented two spaces because models read nested JSON more reliably that way;
human-readable payloads are compact plain text.

Two of these tools have no equivalent that we could find anywhere else in the WebMCP ecosystem:
**`bisect`** (§4) and **`ask_human_visual`** (§12). They are the reason this project exists.

The shapes below are the ones in [`types/domain.ts`](../traces/src/types/domain.ts), which is a
frozen contract. Where a tool needs to say something the frozen type has no field for — "this
selector matched nothing", "the window was clamped" — it adds it alongside the type rather than
bending the type, and those additions are listed per tool.

---

## Tools at a glance

| # | Tool | Kind | Purpose |
|---|---|---|---|
| 1 | `read_session_meta` | read | duration, event count, viewport, UA, navigations, counts |
| 2 | `list_events` | read | only the interesting events, filtered by kind |
| 3 | `find_element` | search | locate an element and its lifetime in the recording |
| 4 | **`bisect`** | **search over time** | **binary search across the replay timeline** |
| 5 | `read_dom_at` | read | agent-legible DOM at a single instant |
| 6 | `diff_dom` | read | what changed between two instants |
| 7 | `read_console` | read | console errors and warnings in a time window |
| 8 | `read_network` | read | requests, statuses, summarized bodies |
| 9 | `measure_layout` | read | geometry, visibility, overlap — visual bugs without pixels |
| 10 | `seek` | **UI effect** | moves the human's playhead |
| 11 | `annotate` | write | a permanent, agent-authored timeline marker |
| 12 | **`ask_human_visual`** | **blocking** | the human answers **and marks a moment** |
| 13 | `propose_hypotheses` | **blocking** | ranked hypothesis cards the human promotes or rejects |
| 14 | `propose_report` | **blocking** | a bug report draft the human edits and approves |
| 15 | `claim_next_task` | **blocking** | pull the next task from the agent lane |
| 16 | `snapshot_finding` | write | save markers, hypotheses and the report draft |

**Blocking** means exactly what it says: `execute()` does not resolve until a person acts, or until
the gate's timeout hands back a ticket. The agent's own loop waits. See
[§Blocking tools](#blocking-tools) for the timeout and retry contract.

---

## Conventions every tool follows

Stated once here rather than repeated sixteen times.

- **Times are milliseconds from the start of the recording**, `0..durationMs`, never epoch. Call
  `read_session_meta` first to learn `durationMs`.
- **Out-of-range times are handled two different ways, on purpose.** Tools that *read* a single
  instant — `read_dom_at`, `diff_dom`, `measure_layout` — **reject** a timestamp outside the
  recording, because an agent asking for 90,000 ms of a 47,000 ms recording has a wrong model of the
  timeline and answering about the last frame instead confirms it with real-looking data. Tools whose
  argument is a *window* or a *position* — `bisect`, `seek`, `annotate`, `ask_human_visual`'s hint —
  clamp instead and report the clamp, because "search to the end" is what `to: 999999` means.
  Windows are never silently swapped: `from > to` is rejected, since it has two plausible repairs and
  picking one hides which was meant.
- **Every schema is closed** (`additionalProperties: false`). An invented argument comes back as an
  error the model can correct rather than as silence.
- **Every response has a budget**, per CONTRIBUTING.md § 2. When one bites, the response sets
  `truncated: true` *and* carries a `note` or `nextStep` sentence saying what to do about it —
  narrow the window, add a container to the selector, cite fewer moments. Agents act on instructions
  far more reliably than on observations, so the flag alone would not be enough.
- **Counts are counted before the cap, not after.** `totalMatched` is the real number of matches, so
  "how many console errors are in this window" is never answered with the cap.
- **Reads do not move the human's playhead.** `bisect`, `find_element`, `diff_dom`, `read_dom_at` and
  `measure_layout` all seek the replay internally and then put it back where the human left it.
  `seek` is the only tool whose job is to move it.
- **Failures are readable tool errors, never thrown exceptions.** They carry `isError` and a sentence
  naming what was wrong and what is accepted. See [§Error behaviour](#error-behaviour).

---

## Read and search tools

### 1. `read_session_meta()`

```
input:  {}
output: { recordingId, durationMs, eventCount,
          viewport: { width, height }, userAgent,
          navigations: [{ atMs, url }],
          counts: { clicks, inputs, consoleErrors, failedRequests },
          navigationsTruncated?, note? }
```

Usually an agent's first call. Deliberately generous, so the agent doesn't have to guess what to
probe next.

This is `RecordingMeta` from `types/domain.ts`, unchanged. Note the field names: `viewport` is
`{ width, height }`, the page list is **`navigations`** (each with the time it was entered, not a
bare `routes: string[]`), and the tallies live under **`counts`** rather than as top-level
`consoleErrorCount` / `failedRequestCount`. Every field is derived once by `load-recording.ts` at
load time and simply forwarded here — this tool counts nothing itself, because a second count could
disagree with the timeline the human is looking at, and two different answers to "how many console
errors" is worse than either.

`navigations` is the only unbounded field in the shape, so it is capped at 20; past that
`navigationsTruncated: true` is set and the note points at `list_events` with
`kinds: ["navigation"]`.

### 2. `list_events({ kinds?, from?, to? })`

```
input:  { kinds?: DigestEventKind[], from?: number, to?: number }
output: { fromMs, toMs,
          events: [{ atMs, kind, summary, selector? }],
          totalMatched, truncated, note? }
```

`DigestEventKind` is the frozen set:

```
click | input | navigation | consoleError | consoleWarn | failedRequest | rageClick
```

**The argument is `kinds`, and its vocabulary is `DigestEventKind` verbatim** — the same strings that
come back in each event's `kind`. There is no `types` argument, and `"console"`, `"error"` and
`"network-fail"` are not accepted: a filter vocabulary that doesn't match the values in the response
cannot be round-tripped, and taking a `kind` out of a response and filtering on it is the first thing
an agent tries. An unrecognised kind is rejected by name with the accepted list, rather than ignored —
an agent that asked for `"error"` and got everything back would conclude the filter works and the
recording is noisy.

`rageClick` is three or more clicks on the same element within a second, which is usually the moment
the user realised something was broken.

**Never returns the full event stream.** A 47-second recording holds thousands of mutation events;
returning them would flood the agent's context for no benefit. Mouse movement, scrolling and plain
DOM mutations are dropped entirely. Hard cap of 40 entries, **earliest kept** — an agent reasoning
about a first occurrence needs the start of the window, not a random slice — with `truncated: true`
and a note offering the two ways out: a narrower window, or fewer kinds.

`selector` is optional in the frozen type and the current digest does not populate it. rrweb carries
only a numeric node id for a click, which cannot be resolved to a selector without the reconstructed
mirror DOM the digest deliberately does not have, so the id goes in the summary text instead. Use
`find_element` to get a selector; do not expect one here.

Both ends of the window default to the whole recording, because "everything" is the right first
question and an agent forced to supply a range before it knows the duration guesses one.

### 3. `find_element({ text?, role?, selector?, timestamp? })`

```
input:  { text?: string, role?: string, selector?: string,   // at least one of the three
          timestamp?: number }
output: { atMs, criteria,
          matches: [{ selector, tagName, textSnippet, firstSeenMs, lastSeenMs,
                      selectorMatchesMultiple?, selectorNote? }],
          totalMatched, truncated, note? }
```

At most 5 matches; `textSnippet` is page text collapsed to one line and capped at 80 characters,
never markup. Given together, the three criteria mean **and**, not or. `role` matches both an
explicit `role` attribute and the implicit role of the tag, so `"button"` also finds `<button>`,
`"combobox"` finds `<select>`, `"link"` finds `<a href>`. Text matching keeps only the **innermost**
match: a `<div>` wrapping the whole form contains the word "Pay" too, and returning it alongside the
button would spend the five-match budget on five ancestors of one element.

`timestamp` defaults to wherever the human's playhead currently is. Pass it when the element only
exists for part of the recording.

The returned selector is what the agent will feed to `bisect` and `measure_layout`, which re-resolve
it at other timestamps, so **it never contains a positional step**. The ranking is
`id` → `data-testid` → `name` → the element hung off the nearest anchored ancestor with a descendant
combinator → a short path of stable authored attributes. `nth-child(3)` resolves to a different
element the moment a sibling is inserted above it, and a bisect over that selector reports a
confident transition for an element nobody asked about. When no unique stable selector exists the
response says so — `selectorMatchesMultiple: true` plus a note — rather than manufacturing one.

`firstSeenMs` / `lastSeenMs` are measured, with two `exists` bisects per match at 500 ms precision:
coarser than `bisect`'s own default because this is orientation, and two searches per match at 250 ms
would triple the cost of a call an agent makes early and often. An element still present at the end
reports `durationMs`, not `null`, which would read as "never seen". A lifetime that could not be
measured comes back `null` rather than as a plausible number.

### 4. `bisect({ selector, predicate, from, to, precisionMs? })`

The tool this project is built around.

```
input:  { selector: string, predicate: Predicate,
          from: number, to: number, precisionMs?: number }   // default 250
output: { firstTrue: number|null, lastFalse: number|null,
          iterations: number, elapsedMs: number, precisionMs: number,
          alreadyTrueAtStart?: boolean,
          trace: [{ atMs, result, elementMissing }],
          searchedFromMs, searchedToMs, note? }
```

The agent sends a **predicate**. The page runs a binary search: it replays to a midpoint, evaluates
the predicate against the reconstructed DOM, and repeats. Ten iterations gets 250 ms precision on a
47-second recording — eight halvings plus the two boundary probes — and because each probe restarts
from the nearest checkpoint rather than from zero it costs about a second rather than about ten. Ten is
also the count wherever the transition sits: a binary search pays the same price everywhere, so the
number is a property of the window and the precision, not of the bug.

This is the part that cannot be a REST endpoint. The agent is not fetching data — it is asking the
page to *run a computation over time* that only a live replay engine can perform. There is no HTTP
shape for "replay this recording to ten different moments and tell me where this became true", and no
amount of DOM-scraping produces it either.

**Contract details an agent needs:**

- The predicate is assumed **monotonic** within `[from, to]` — `false` then `true`, once. If it flips
  more than once, you get *one* transition point, not all of them.
- Already true at `from` → `{ firstTrue: from, alreadyTrueAtStart: true }`, and `lastFalse` is
  `null`, because the predicate was never observed false anywhere in the window. `firstTrue` is then a
  floor, not a transition; the note says so and tells the agent to search from 0.
- Never true by `to` → `{ firstTrue: null }`. Not an error: "this never happened" is an answer, and
  the note says as much rather than inviting a retry.
- If the element does not exist at a probed instant, the predicate evaluates `false` **and** that
  step carries `elementMissing: true`. This distinction matters: "the button is not disabled" and
  "the button does not exist yet" are different findings, and conflating them produces confidently
  wrong conclusions.
- `iterations` counts **every probe**, the two boundary probes at `from` and `to` included, because
  what the number means to a reader is "how many replays did this cost".
- `precisionMs` in the response is the precision the search ran to — the value you passed, or the
  default. The search halves the interval until it is no wider than that, so the answer is at least
  that precise, and the field is an echo rather than a measurement. `elapsedMs`, by contrast, *is*
  measured.
- `from` and `to` are clamped into the recording and the clamped window comes back as
  `searchedFromMs` / `searchedToMs`, with a note when it differed from what was asked. `from > to` is
  rejected.
- `precisionMs` must be a positive number. A predicate that cannot apply to the element it found —
  `optionCount` against a `<div>` — comes back as a readable error naming the tag, not as a
  plausible `false`.

`trace` is not decoration — the UI animates it, which is how a human watches the playhead jump six
times and understands what the agent just did.

Predicate grammar: [§Predicates](#predicates).

### 5. `read_dom_at({ timestamp, scope? })`

```
input:  { timestamp: number, scope?: string }   // scope is a container selector
output: plain text — the agent-legible DOM
```

```
DOM at 28412 ms (scope #checkout):

form#checkout [visible]
  input[name=email][type=email] value="ana@example.com" placeholder="Email"
  input[name=card][type=text] value="" aria-invalid=true [required]
  select[name=province] [empty options: 0] [required]
  button[type=submit] "Pay" [DISABLED]
  div.error "Province is required"

6 lines, 295 chars (from 41208 chars of HTML).
```

Six lines, not 800 KB. The rules that produce this — and the hard budget of 60 lines / 1,200
characters, enforced by a test — are in [agent-legible-dom.md](agent-legible-dom.md).

Returned as plain text rather than JSON on purpose: the indentation is what carries the tree
structure, and wrapping it in JSON would escape every newline, turning something the model can *see*
into something it has to decode.

Two things worth knowing about the annotations: `[visible]` is emitted on the scope root only, since
repeating it per line costs more tokens than it conveys, and there is no `[valid]` / `[invalid]`
verdict. State is reported through the attributes the page actually carries — `aria-invalid`,
`required`, `readonly`, `[DISABLED]`, `[checked]`, `[empty options: 0]` — because the compressor
reports what was on the page rather than computing an opinion about it.

`scope` narrows to a container and is the documented answer to a truncated whole-page read; the
truncation advice in the footer says so. A scope selector that matches nothing at that instant is a
readable error pointing at `find_element`, not an empty tree.

### 6. `diff_dom({ from, to })`

```
input:  { from: number, to: number }   // both required, and must differ
output: { fromMs, toMs,
          changes: [{ kind, selector, before?, after? }],
          truncated,
          counts: { added, removed, attributeChanged, textChanged },
          note? }
```

`kind` is one of `added` | `removed` | `attributeChanged` | `textChanged`. `before` and `after` are
present for the latter two, both sides truncated. There is no top-level `{ added, removed, changed }`
grouping and no per-change `attribute` field: one flat `changes` list with a `kind` is what
`DomDiffResult` freezes, and `counts` is added alongside it so an agent can see the shape of the
diff without tallying it.

Capped at 30 changes, least informative dropped first — interactive elements and structural changes
are kept. Only elements `read_dom_at` would show are compared.

Use it straight after `bisect`: `bisect` tells you *when* something changed, this tells you what else
changed at the same time, which is usually where the cause is. Keep the interval tight; a second
either side of a transition beats the whole recording.

**`scope` is not supported.** An earlier version of this document listed one. `diffDom` roots itself
at `document.body` and has no seam for a subtree, and faking one by building a throwaway document
around a cloned subtree would put DOM surgery in a tool wrapper. Declaring an argument that is
silently ignored is worse than not having it — an agent would believe it had narrowed the diff and
would read the result as complete. So the argument is absent from the schema and a call that passes
it is rejected. Narrow the *interval* instead.

`from` and `to` must be different moments, and `from` must be the earlier one: the response describes
what changed going forwards in time.

### 7. `read_console({ from?, to? })`

```
input:  { from?: number, to?: number }
output: { fromMs, toMs,
          entries: [{ atMs, level: "error"|"warn", message }],   // message capped at 200 chars
          totalMatched, errorCount, warnCount, truncated, note? }
```

**Only `error` and `warn` can ever come back.** The event digest this reads keeps console events at
those two levels and drops everything else, so `log`, `info` and `debug` are unreachable — not
filtered out by an argument, absent from the data. This is stated rather than left to be discovered
because an empty result must not be misread as "the page logged nothing at all"; it means "nothing
was logged at error or warning level". The tool's own description says the same thing to the model.

Chronological, because reading console output is reconstructing a sequence. The *cap* of 40, though,
drops warnings before errors: clipping the tail in time order would throw away the error at the end
of a noisy window, which is usually the reason the window was interesting. Time order is restored
after ranking.

`message` is capped at 200 characters. A stack trace pasted into `console.error` is routinely several
kilobytes and the useful part is at the front. (Today the digest has already truncated each summary
to 120, so the 200 is a backstop — but it is this tool's promise to the agent, so it is enforced here
rather than left as a fact about somebody else's constant.)

### 8. `read_network({ from?, to?, filter? })`

```
input:  { from?: number, to?: number, filter?: string }   // filter is a case-insensitive URL substring
output: { fromMs, toMs, filter?,
          requests: [{ atMs, method, url, status?, ok?, durationMs?, bodySummary? }],
          totalMatched, failedCount, truncated, note? }
```

**Successful requests are included**, which is the point: "the request went out and came back empty"
is as much a finding as "the request failed", and a network tool that reported only failures would
answer "did the checkout call the provinces endpoint" with "no" when in fact it called it and got a
200 with an empty array.

`bodySummary` is a summary, never a raw body: an array becomes `"array, 0 items"`, an object becomes
its key list. Response bodies are both large and likely to contain personal data — two independent
reasons not to forward them. It is forwarded only when the recorder already summarised it, and is
never derived here from anything resembling a body.

Every field except `atMs`, `method` and `url` is **omitted when the recorder didn't capture it**,
rather than filled with a default. A missing method renders as `"unknown"`, not `"GET"`: a default
here is an invention, and an agent quoting it in a bug report has been handed a fact nobody recorded.
`url` is capped at 200 characters and `bodySummary` at 120.

Capped at 40 requests, failures (explicit `ok: false`, or status ≥ 400) kept ahead of successes, then
chronological order restored. An empty result carries a note warning that the recording may have been
captured without network instrumentation — check `counts.failedRequests` from `read_session_meta`
before concluding the page made no requests.

### 9. `measure_layout({ selectors, timestamp })`

```
input:  { selectors: string[], timestamp: number }   // both required
output: { atMs,
          boxes: [{ selector, x, y, width, height,
                    visibility: "visible"|"hidden", display, zIndex }],
          overlaps: [{ above, below, overlapArea }],
          notMatched?, notMatchedNote?, zeroSizedNote?, overlapNote? }
```

This is how Traces catches visual bugs **without pixels** — for instance a button that is present,
enabled, and simply covered by another element, so clicks never land.

**The argument is `selectors`, an array, not a single `selector`,** and that is not a convenience.
`overlaps` is computed pairwise over the boxes in *one* result, so the covering element has to be
measured in the same call as the covered one. Pass the element the user aimed at *and* the elements
you suspect were on top of it together; measuring them separately answers nothing.

The frozen `LayoutBox` reports computed `visibility` (`'visible' | 'hidden'`), `display` and
`zIndex`. There is **no `visible` boolean, no `occludedBy`, and no `insideViewport`**: occlusion is
answered by `overlaps`, and viewport containment is not computed at all — compare `x`/`y`/`width`/
`height` against `viewport` from `read_session_meta` if you need it. `visibility: 'collapse'` folds
into `'hidden'`, the closer of the two available values.

- At most 10 selectors, and at most 20 boxes once each selector's matches are counted. The count
  happens *before* measuring and the call is rejected if it would exceed the cap, rather than
  truncating after: a box dropped from the response would silently drop the overlap pairs it was part
  of, which is the one answer this tool exists to give.
- When one selector matches several elements, each match gets its own box labelled
  `"<selector> [match 2/3]"`. That is deliberately not valid CSS — fed back into a later call it
  fails loudly instead of quietly resolving to the wrong element, which a synthesized `nth-of-type`
  guess would do.
- A selector that matched nothing is listed in `notMatched`, because `LayoutResult` has nowhere to
  say so and an agent that asked about three elements and got two boxes should not have to work out
  which.
- A pair is reported in `overlaps` only when the two boxes intersect **and** their z-indices differ;
  equal z-index (including `auto` against `auto`, and `auto` against an explicit `0`) carries no
  information about which is on top. Zero-area boxes cannot overlap anything and are excluded, with a
  note naming them — an element in the document with no layout box is itself a finding.
- Every number is rounded once, at construction, so the overlap arithmetic and the numbers the agent
  reads are the same numbers.

---

## Write and UI tools

### 10. `seek({ timestamp, play? })`

```
input:  { timestamp: number, play?: number }   // play = milliseconds to play for, capped at 5000
output: { ok: true, at: number, playedMs: number, truncated?, nextStep? }
```

The only tool whose effect is purely on human attention. The agent is not retrieving anything — it
is pointing at evidence and saying *look here*. Call it before asking a question.

`at` is the position actually reached, not the one requested: `timestamp` is clamped into the
recording and the clamp is reported. `play` is bounded playback, capped at 5,000 ms and **awaited** —
nothing is still moving the playhead once the call returns, so the next `read_dom_at` is not fighting
a ticker. A model that asks to play thirty seconds is asking the tool call to hang for thirty
seconds, which every host tolerates differently and no agent recovers from gracefully; the response
says to call `seek` again from where playback stopped.

### 11. `annotate({ timestamp, label, severity })`

```
input:  { timestamp: number, label: string, severity: "info"|"warn"|"error" }
output: { ok: true, id, at, severity, remaining?, nextStep? }
```

**`severity` is the frozen `Severity`: `info` | `warn` | `error`.** `"low"`, `"medium"` and `"high"`
are not accepted — an earlier version of this document listed them, and a call that uses them comes
back with an error naming the three valid values. The timeline's colours are keyed to these three,
and `severityOf` in the store maps digest kinds onto the same set. Use `error` for something broken,
`warn` for something suspicious, `info` for a moment worth finding again.

Stored with `author: "agent"`, rendered in the agent's colour, individually undoable by the human.

- `label` is capped at 80 characters and a longer one is **rejected, not trimmed**: the label *is*
  the marker on screen, and a silently clipped one reads as a marker about something else. Put the
  reasoning in `propose_hypotheses`.
- At most 40 agent markers on one timeline. This budget is on the human's screen rather than on the
  response: an agent that annotates every console error in a noisy recording produces a uniformly
  marked timeline, which points at nothing. Past the limit the error says to move on to
  `propose_hypotheses` or `propose_report`.
- Repeating the same label at the same moment returns the **existing** id and adds nothing. A host
  that reissues a tool call is not a human marking twice.
- `timestamp` is clamped into the recording, and the response says where the marker actually landed.

---

## Blocking tools

Four tools do not resolve until a person acts. This is what makes the human a tool inside the
agent's loop rather than a spectator watching it finish.

The hard part is not the waiting, it is the tolerance of whichever host is running the agent. Nobody
publishes how long a pending tool call is allowed to stay pending, and the answer differs between an
in-app browser, an extension inspector, and a bare Chrome tab. So the rule is: **never leave a call
unresolved.** Each blocking tool resolves one of three ways:

```
output: { status: "answered", ...payload }             // the human acted
     |  { status: "pending", ticket, waitingOn, nextStep }   // a normal response, not an error
     |  a readable tool error                          // the question is gone: dismissed,
                                                       // withdrawn, superseded, or the ticket is dead
```

**`pending` is a conversation, not a failure.** It is a normal (non-error) response, and it says
three things the agent is expected to act on: the human is still looking, retry **with the ticket**,
and leave a few seconds between retries instead of polling tightly. Tell the user you are waiting on
them rather than going quiet.

**Every blocking tool takes an optional `ticket` argument, and that is what stops these four tools
from hanging.** The contract, precisely:

- A retry that passes the ticket **reattaches to the same open question**. It does not open a second
  one. This is the subtle bug the ticket exists to prevent: the human answers the first prompt, the
  agent waits on a second, and both sides sit there each believing the other is slow. The tools'
  schemas say "do not invent one" for the same reason.
- The question **outlives the timeout**. Only the individual call gives up; the prompt stays on the
  human's screen and something stays watching for their action.
- An answer that arrives **between two polls** — the common case, since the first call has already
  returned and the retry has not arrived — is parked on the ticket and handed to whichever retry
  comes next. Without that, the answer would be dropped, the agent would poll forever, and the UI
  would show a question the human had already answered.
- A second answer on the same ticket is **ignored**. Two clicks on one prompt is a human being
  unsure, not two answers, and the agent has already been told the first one.
- An **unknown or already-collected ticket** is a readable error: *"Ticket "…" is not open: either its
  answer was already collected, or the page was reloaded since it was issued. Nothing is waiting on
  it. Call … again without a ticket to start a fresh request."* Calling again *without* a ticket is
  the recovery, and the message says so — a model that guesses a ticket gets told exactly that.
- Tickets live for the tab's lifetime. There is no server, so there is nothing to expire against; a
  reload retires every one of them.

The timeout is `GATE_TIMEOUT_MS`, currently 8 s, and that number is a measurement. A 25 s gate lost a
`propose_hypotheses` call outright: the ChatGPT in-app browser cut the agent's control connection at
roughly 20 s, so the host gave up before the gate returned its ticket — the card rendered and the
human's decision was recorded, but the agent received neither. Re-measure before targeting a host with
a different tolerance, and keep the value comfortably under whatever you measure.

### 12. `ask_human_visual({ question, choices, hintAtMs?, ticket? })`

```
input:  { question: string,          // ≤ 300 chars
          choices: string[],         // 2–4 distinct options, each ≤ 40 chars
          hintAtMs?: number,         // where to point the player; they may mark elsewhere
          ticket?: string }
output: { status: "answered", choice, markedTimestamp, note?, markerId?, nextStep }
     |  { status: "pending", ticket, waitingOn, nextStep }
     |  a readable error if the human dismissed the question
```

The agent cannot see rendered output. When a question genuinely requires eyes — *does this dropdown
look broken, or does it look normal but empty?* — it asks the human, and the human answers by
**clicking on the player** at the relevant moment. The answer comes back as structured data
(`{ choice, markedTimestamp }`), not prose.

**The human is the eyes. The agent is the reasoner.** That is the inverse of an agent taking a
screenshot and guessing, and it is a better fit for what each party is actually good at. It exists
because of a real limitation of the current spec — `content` supports `"text"` and an `"image"` type
is still an open question — and it turned out better than the screenshot version would have been: a
screenshot costs thousands of tokens and still leaves the model guessing about state it cannot read
off pixels, while a human costs one click and answers the question exactly.

Use this for perceptual questions only. Anything answerable from state belongs in `read_dom_at`,
`measure_layout`, or `bisect`.

**There is no `expects` argument.** An earlier version of this document offered
`"choice" | "timestamp" | "timestamp+choice"`; the answer always carries **both**, so there was
nothing to choose between. What the schema does have, and the old contract didn't mention, is
`hintAtMs` — the agent's suggested place to look, which the player seeks to — and `ticket`.

- `choices` must hold 2 to 4 **distinct** options, each under 40 characters. Fewer than two is a
  confirmation dialog, not a question; more than four is a form. A choice too long for a button over
  the player is read half-truncated and answered wrongly, which is the one failure mode here that
  produces *bad data* rather than no data. Duplicates are rejected rather than de-duplicated: two
  identical buttons are two things the human cannot tell apart.
- `question` is capped at 300 characters — it sits in a narrow panel next to the replay. Say what you
  know and what you cannot determine, in two sentences.
- On an answer, a marker **authored by the human** is dropped at `markedTimestamp` and its id comes
  back as `markerId`. They are the one who saw it, so their answer becomes evidence on the timeline
  that anyone can click, rather than a sentence in a transcript. The timestamp they marked is a fact:
  work from it with `read_dom_at` or `bisect` instead of asking a second question about the same
  moment.
- **One question at a time**, because the human can only look at one thing. A second call while a
  question is open reattaches to the open question's gate rather than opening another — the same rule
  as the ticket path, applied to an agent that forgot its ticket.
- A **dismissal** — the human closing the question without answering — resolves the call as a
  readable error telling the agent not to re-ask, and to say in its answer which part it could not
  confirm. Without that, the agent would poll a ticket nothing will ever answer.

### 13. `propose_hypotheses({ hypotheses, ticket? })`

```
input:  { hypotheses: [{ text,                 // ≤ 240 chars
                         confidence: number,   // 0..1
                         evidence: [{ atMs, note?, markerId? }] }],   // 1–5 per hypothesis
          ticket?: string }
output: { status: "answered", promoted: string[], rejected: string[],
          decided: [{ index, text, status }], nextStep }
     |  { status: "pending", ticket, waitingOn, proposed, normalisedConfidences, nextStep }
     |  a readable error if the human removed the set instead of deciding
```

Two to five hypotheses — one explanation is a conclusion, not a ranked set. Best first.

**Evidence entries are `{ atMs, note?, markerId? }`.** There is no `kind` field and the time key is
`atMs`, not `timestampMs`: this is `Hypothesis.evidence` from the frozen contract, verbatim. Every
hypothesis must carry at least one piece, and that rule *is* the tool — clicking a card highlights
all of its evidence across the timeline at once, and a card with nothing behind it is an assertion
with a percentage attached.

- At most 5 evidence entries per hypothesis; beyond that the extras are clipped and a budget note
  says to cite the strongest ones. `note` is capped at 120 characters.
- `atMs` must be inside the recording, and `markerId` — when given — must be an id `annotate`
  actually returned. Both are checked against the session rather than taken on faith, because either
  produces a chip that highlights nothing when clicked, which looks like a broken UI rather than a
  bad argument.
- **Confidences are normalised by the page**, rescaled so the set sums to 1. A model asked for
  confidences produces four numbers that each look reasonable and sum to 2.4, and the cards are drawn
  as bars relative to each other, so unnormalised input renders a set where every hypothesis looks
  near-certain. Non-finite and negative claims count as 0; if that leaves nothing to scale the set is
  split evenly. Rounding is to three places and for display only, so a set of three may sum to 0.999.
  The `pending` response reports `normalisedConfidences` so the agent knows what the human is seeing.
- The call settles when **one card is promoted, or every card is rejected** — not when every card has
  been individually decided. People promote the one they believe and leave the rest alone, and a rule
  that waited for all of them would keep an agent polling a set the human considers finished.

### 14. `propose_report({ title, summary?, steps, expected?, actual?, rootCause, evidence?, ticket? })`

```
input:  { title: string,                        // required, ≤ 120 chars
          summary?: string,                     // ≤ 600 chars
          steps: [{ text, atMs? }],             // required, ≤ 12, text ≤ 200 chars
          expected?: string, actual?: string,    // ≤ 600 chars each
          rootCause: string,                    // required, ≤ 600 chars
          evidence?: [{ atMs, note? }],          // ≤ 10
          ticket?: string }
output: { status: "answered", approved: true, editedByHuman, finalText,
          steps: [{ text, atMs?, verified }], unverifiedCount, truncated?, nextStep? }
     |  { status: "answered", approved: false, nextStep }
     |  { status: "pending", ticket, waitingOn, nextStep }
     |  a readable error if a newer draft superseded this one
```

The input is wider than the four fields this document used to list, because `Report` is wider:
`summary`, `expected` and `actual` are accepted (and default to empty) since a report without them
reads as half-written, and the two shapes changed for reasons rather than taste:

- **`steps` are `{ text, atMs? }`, not `string[]`.** `buildReport` can only verify a step that claims
  a timestamp — there is nothing to centre a search window on otherwise — so a bare string is
  unverifiable *by construction* and every step would come back unverified. Pass `atMs` whenever you
  know it. Passing an **empty array** is meaningful: the page then reconstructs the steps from the
  recorded events instead, and those are verified because they *are* recorded events restated.
- **`evidence` is `{ atMs, note? }`, not `number[]`.** A bare number loses the note that makes an
  evidence chip readable.
- **`domSnippet` is not accepted.** `Report` has no field for it and `types/domain.ts` is frozen, so
  rather than declare an argument and silently drop it, the closed schema rejects the call. An agent
  that sends one is told, instead of believing a snippet reached the human.

  > **Known gap.** PRD FR7 asks for a DOM snippet in the report. It is not implementable behind this
  > tool today: it needs a `Report.domSnippet` field, which is a change to the frozen contract and
  > therefore a conversation rather than a commit. Until then, point the human at the moment with
  > `evidence` and let them read the state with the player. This is a documented gap, not an
  > oversight in the tool.

**`steps` are validated, not trusted.** `buildReport` recomputes `verified` for every step against
the recording's own event stream and never trusts an incoming value: a step whose claimed moment has
no user-action event within 2 seconds — or that falls outside the recording — comes back
`verified: false` and is shown to the human as unverified rather than dropped. A report that quietly
omits a step reads as complete when it isn't. A verified step's `atMs` is rewritten to the matched
event's real timestamp, and an unverified step's `atMs` is dropped entirely, so no code reading
`atMs` can mistake a model's guess for a confirmed moment.

Be precise about what that verification claims: matching is by **time only**, never by comparing the
step's prose to the event's summary. Text similarity would reward good writing rather than accuracy —
a confident on-topic sentence passes as soon as any click happens nearby. So `verified: true` means
*"a real user action happened near this moment"*, not *"this step describes that action"*. Closing
that gap needs a claimed `kind` on `ReportStep`, which the frozen contract does not have. The
response reports `unverifiedCount` and tells the agent not to describe those steps to the user as
reproduced.

`editedByHuman` is set when the human changed the draft before approving; quote their wording, not
yours. Only one draft can be under review at a time — propose a second and you get an error telling
you to retry the first with its ticket rather than replacing what they are reading.

### 15. `claim_next_task({ ticket? })`

```
input:  { ticket?: string }
output: { status: "answered", taskId, text, claimedAt, truncated?, nextStep? }
     |  { status: "pending", ticket, waitingOn, nextStep }
```

Pulls the next task a human dropped into the agent lane, and blocks until one exists — so it is how
an idle agent waits for work rather than polling for it. This is the tool that inverts who waits on
whom: everywhere else an agent is invoked and a person waits for it.

- A task already open is handed over immediately, with no gate at all.
- Claiming happens **inside** the store watcher's detector, so checking and claiming are one step.
  Two waiting calls therefore cannot be handed the same work: the loser keeps waiting for the next
  task.
- `text` is capped at 400 characters. A task is a sentence, not a brief; if it was longer the
  response says to ask the human to restate it rather than guessing at the rest.
- **Deliberately does not require a loaded recording.** Waiting for work is what an idle agent does,
  and a tool that refused until a recording existed could not be the thing that tells it one is
  ready.

---

## Saving findings

### 16. `snapshot_finding({ name? })`

```
input:  { name?: string }   // ≤ 60 chars; defaults to the recording id plus the time
output: { ok: true, id, name,
          counts: { markers, hypotheses, reportSteps },
          charCount, truncated, nextStep? }
```

Serialises the markers, hypotheses and report draft to `localStorage` under one key, so a reload does
not lose an investigation and the human can copy the JSON out. `id` is that storage key
(`traces.snapshot.<recordingId>.<slug>`); the name is slugified to a closed character set before it
becomes part of it.

A snapshot is a record of an investigation, not an export of the session: at most 60 markers, 20
hypotheses and 40 report steps, and a 200,000-character ceiling on the serialised payload. Every
rejection path is a readable error — storage blocked by a privacy setting, quota refused, or nothing
saved yet because there are no markers, no hypotheses and no draft. In the first two cases the
findings are still on screen and the message says to copy them out of the panel.

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
| `text` | non-empty, ≤ 100 characters | rejected |
| `equals` | typed per kind: boolean for `visible`/`exists`, non-negative integer for `optionCount`, string for `attributeEquals`, string or boolean for `propertyEquals`; strings ≤ 100 characters | rejected, naming the expected type |
| `selector` | non-empty, ≤ 200 characters, must parse as a valid selector | rejected up front, before the search starts, not thrown on iteration 3 |

Errors come back as readable tool errors, not exceptions — an agent that gets
`Unsupported predicate kind 'jsExpression'. Supported: propertyEquals, attributeExists, ...` will
correct itself on the next call.

`optionCount` against anything but a `<select>` is the one rule that can only be checked at probe
time, and it is a readable error naming the tag it found rather than a silent `false`: a caller
asking for the option count of a `<div>` has almost certainly pointed the selector at a wrapper, and
`false` would look like a legitimate answer instead of a mistake to fix.

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

Nothing throws out of a tool. A thrown exception reaches the model as a host-level failure it can
only report; a sentence naming what was wrong and what is accepted gets corrected on the next call.
So every rejection is a `ToolResponse` with `isError` set and a readable message.

Three classes of error, and the difference between them is what the agent should do next:

**The agent's to fix.** A malformed argument, an unsupported enum value, a selector that doesn't
parse, a timestamp outside the recording. The message names the field, the accepted values and
usually an example. Arguments are always validated *before* the replay engine is touched, precisely
so a bad argument is never answered with "try again" — an agent told to retry retries the same bad
argument, forever.

**Temporary, worth retrying.** The replay player has not finished mounting, or the replay could not
be positioned yet:

```
The replay player has not finished mounting yet, so there is no reconstructed page to read.
This is temporary: wait a moment and call this tool again. If it keeps happening, ask the
human to open one of the sample recordings in the player.
```

**Nothing loaded.** Tools that need a recording stay registered at all times — a capability that
disappears from the tool list looks to an agent like a capability that never existed — and return:

```
No recording is loaded. Ask the human to pick one of the sample recordings first, then call
read_session_meta.
```

An agent handed that sentence will relay it to the user, which is more useful than a tool that
appears and disappears from the surface depending on page state. `claim_next_task` is the deliberate
exception: it works with no recording loaded, because waiting for work is what an idle agent does.
