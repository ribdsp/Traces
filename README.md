# Traces

**A session replay engine that an AI agent can interrogate — through WebMCP.**

Traces turns a recorded browser session into something an agent can *ask questions of*: not "summarize
this video", but "find the exact millisecond the pay button became disabled, and tell me what
happened just before it."

Built for [The WebMCP Challenge](https://webmcp.devpost.com/) by Riko, Vicko, and Faiq.

- **Live demo:** <!-- TODO: production URL -->
- **Video (3 min):** <!-- TODO: YouTube link -->
- **Tool reference:** [docs/tools.md](docs/tools.md)

> **Status: work in progress.** The design is settled and documented; the implementation is being
> built during the challenge window. Sections marked <!-- TODO --> are placeholders, and every
> measured number in these docs is filled in from a real run rather than estimated. If a claim here
> isn't yet backed by code, [Status and limitations](#status-and-limitations) says so explicitly.

---

## The problem

A user reports: *"I couldn't complete my order. The pay button just stayed grey."*

You have a session recording. Forty-seven seconds of it. So you do what everyone does — scrub back and
forth, guess where the interesting part is, scrub again. Somewhere in there is one moment where a
`select` element quietly ended up with zero options, which failed validation, which disabled the
button. Finding it takes fifteen minutes of attention that could have gone to fixing it.

Now try handing that recording to an AI agent. It can't. Session replay is *rendered pixels over
time* — there is no API for "what did the DOM look like at 28.4 seconds", because the DOM at 28.4
seconds doesn't exist anywhere. It's the **result of a computation**: replaying thousands of mutation
events from the start of the recording. No backend can return it. Only a live replay engine can
produce it, and only while it's running.

That's the gap Traces fills.

---

## What it does

Traces loads an rrweb recording in the browser and registers **16 WebMCP tools** on
`document.modelContext`. An agent connected to the page can then read the session, search across
time, take actions on the timeline, and — this is the part we care most about — **ask the human
questions**.

A real run looks like this:

```
Agent: read_session_meta()
     → 47.2s, 312 events, 1 console error, 1 request returning an empty array

Agent: find_element({ text: "Pay" })
     → button#pay-submit, present from 2.1s to end

Agent: bisect({ selector: "#pay-submit",
                predicate: { kind: "propertyEquals", property: "disabled", equals: true },
                from: 0, to: 47200 })
     → firstTrue: 28_577ms   (10 iterations, 1.4s, ±250ms)

        ← the playhead visibly jumps ten times while this runs

Agent: read_dom_at({ timestamp: 28577, scope: "#checkout" })
     → form#checkout [visible]
         input[name=email] value="ana@..." [valid]
         select[name=province] [empty options: 0]
         button[type=submit] "Pay" [DISABLED]
         div.error "Province is required" [visible]

Agent: read_network({ from: 10000, to: 15000, filter: "provinces" })
     → GET /api/provinces → 200, bodySummary: "array, 0 items"

Agent: ask_human_visual({ question: "Did the province dropdown look broken, or normal but empty?",
                          expects: "timestamp+choice",
                          choices: ["looked broken", "looked normal but empty"] })

        ← the tool call blocks. A prompt appears. The human clicks the player at 12.8s
          and picks an answer. Only then does execute() resolve.

     → { choice: "looked normal but empty", markedTimestamp: 12_800 }

Agent: propose_report({ ... })
     → a draft bug report with reproduction steps validated against the real event stream,
       waiting for the human to approve
```

Root cause in under 90 seconds, and the human's fifteen minutes of scrubbing was replaced by one
click that only a human could make.

---

## Why this needs WebMCP

WebMCP is the [W3C draft](https://github.com/webmachinelearning/webmcp) that lets a page expose tools
to an agent through `document.modelContext.registerTool()`. Lots of things *could* be built with it
that would work just as well as a REST API. Traces is not one of them, and the reasons are worth
stating precisely:

**1. The answer doesn't exist until the page computes it.** `read_dom_at(28577)` isn't a lookup. The
page must replay the mutation stream to that instant and reconstruct the DOM. A server holding the
same recording file cannot answer the question without becoming a replay engine itself.

**2. `bisect` doesn't fetch — it *programs* the page.** The agent sends a predicate and the page runs
a binary search across the replay timeline, ten probes deep. The agent isn't retrieving data; it's
handing the page an algorithm to execute over time. There is no request/response shape for that.

**3. The human is inside the agent's loop, not watching it.** `ask_human_visual` doesn't resolve until
someone clicks. WebMCP's `execute()` returns a Promise, so a tool can simply *not resolve* — which
turns a person into a callable tool the agent invokes when it hits the edge of what it can perceive.
An API can't block on a human who is looking at your screen.

**4. The tool's side effect is on human attention.** `seek()` moves the playhead. `annotate()` puts a
marker on the timeline that a person sees. The agent isn't reading state — it's pointing at evidence
and saying *look here*. That's only possible because the tool provider and the user interface are the
same page.

Then there's the reverse direction, which we didn't expect to be the interesting part: **WebMCP tools
can currently only return text.** The spec defines a `content` array where `"text"` is the only
specified type; `"image"` remains an open question. We could not send a screenshot if we wanted to.

That constraint produced the two best ideas in the project — see below.

---

## The two ideas we're proudest of

### `bisect` — search over time, not over data

Everyone building a replay integration writes `read_dom_at(t)`. The interesting question is how the
agent *finds* `t`. The obvious answer is linear: read the DOM every second and look for the change.
On a 47-second recording that's 47 tool calls and a flooded context window.

`bisect` inverts it. The agent describes the condition it's looking for, and the page finds the
moment:

```js
bisect({
  selector: "select[name=province]",
  predicate: { kind: "optionCount", equals: 0 },
  from: 0, to: 47200
})
// → { firstTrue: 12_721, lastFalse: 12_537, iterations: 10, elapsedMs: 1_180, precisionMs: 250,
//     trace: [ { atMs: 0, result: false }, { atMs: 47200, result: true },
//              { atMs: 23600, result: true }, { atMs: 11800, result: false }, ... ] }
```

Ten probes instead of forty-seven calls: the two boundary probes that bracket the window, then eight
halvings to close it to 250 ms. The count is the same wherever the transition sits — that is what a
binary search buys. (`elapsedMs` is the one number above that depends on the machine; the probe count
does not.) The `trace` isn't decoration either — the UI animates it, so a human watches the playhead
jump ten times and *sees* the agent's reasoning as motion on the timeline.

Predicates are a **closed set of seven structured shapes**, never a string, and never evaluated. That's
a security property (see [threat model](docs/threat-model.md)) but also a usability one: models fill in
a schema far more reliably than they compose a JavaScript expression, so `bisect` tends to work on the
first try.

### `ask_human_visual` — the agent asks the human to look

Every agent-plus-browser demo points the same direction: agent perceives, human watches. Traces has a
tool that points the other way.

Some questions are genuinely perceptual. *Did this dropdown look broken, or did it look normal but
empty?* No amount of DOM state answers that, and a screenshot wouldn't help an agent that has to
reason about it in tokens. So the agent declares the limit of its own perception and asks:

```js
ask_human_visual({
  question: "Did the province dropdown look broken, or normal but empty?",
  expects: "timestamp+choice",
  choices: ["looked broken", "looked normal but empty"]
})
// blocks…  the human clicks the player at the relevant moment and picks
// → { status: "answered", choice: "looked normal but empty", markedTimestamp: 12800 }
```

The human answers **by pointing at the recording**, and the answer comes back as structured data —
`{ choice, markedTimestamp }` — not prose the agent has to parse.

**The human is the eyes. The agent is the reasoner.** That division of labour matches what each side
is actually good at, and it exists because the spec wouldn't let us send images. The constraint made
the design better.

---

## The 16 tools

Full contracts, argument shapes, and edge-case behaviour in **[docs/tools.md](docs/tools.md)**.

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
| 10 | `seek` | UI effect | moves the human's playhead |
| 11 | `annotate` | write | a permanent, agent-authored timeline marker |
| 12 | **`ask_human_visual`** | **blocking** | the human answers **and marks a moment** |
| 13 | `propose_hypotheses` | blocking | ranked hypothesis cards the human promotes or rejects |
| 14 | `propose_report` | blocking | a bug report draft the human edits and approves |
| 15 | `claim_next_task` | blocking | pull the next task from the agent lane |
| 16 | `snapshot_finding` | write | save a finding |

Four of them **block**: `execute()` does not resolve until a person acts. Because a call can't hang
forever, each one returns `{ status: "pending", ticket }` on timeout instead of leaving the agent
waiting, and the agent collects the answer later with the same ticket. A blocking tool that never
returns is a broken tool; a blocking tool that returns "still thinking" is a conversation.

---

## Making the DOM legible to a model

A real page is 200–800 KB of HTML. Returning that from a tool doesn't produce an error — it produces a
plausible-looking response that consumes the agent's whole context window and quietly degrades
everything after it.

So no tool in Traces ever returns raw DOM. `read_dom_at` returns a representation designed for a
language model to read:

```
form#checkout [visible]
  input[name=email] value="ana@..." [valid]
  input[name=card] value="" [invalid] aria-invalid=true
  select[name=province] [empty options: 0]
  button[type=submit] "Pay" [DISABLED]
  div.error "Province is required" [visible]
```

Interactive and state-bearing nodes only. Attributes from a **whitelist**, not a blacklist. Text
truncated at 60 characters. Tailwind class soup discarded entirely. A hard budget of **60 lines and
1,200 characters**, enforced by a test rather than by good intentions — a budget maintained by
discipline erodes in a week.

Compression on the primary sample: **2,026** characters of raw `outerHTML` down to **663** characters
— `form#checkout` in `empty-province` at 38,048 ms, 25 elements rendered as 17 lines, **3.06×**. Same
recording, same timestamp, measurement script in the repo
(`traces/scripts/measure-compression.mjs`; the other two samples measure 2.68× and 2.57×). The ratio
is modest because this demo page is deliberately lean markup — it is a property of the page, not of
the algorithm, and the response side is what the 1,200-character budget caps.

Notice what the compressed form gives an agent that a screenshot never could: it can read
`aria-invalid`, count `option` elements that were never rendered, and distinguish a genuinely disabled
button from a merely grey one. Full spec:
**[docs/agent-legible-dom.md](docs/agent-legible-dom.md)**.

---

## Human and agent in the same room

Traces is one workspace with two participants, and it's built so you can always tell them apart.

- **Every mutation carries an author.** `author: "human" | "agent"` on markers, hypotheses, findings,
  and report edits. Not a convention — a required field on every state action.
- **An activity feed** shows who did what, in order.
- **Every agent contribution is individually accept / reject / undo-able.** Not one bulk "clear all",
  because trust is built at the granularity of single claims.
- **An agent lane** where a human drops a task, and `claim_next_task()` blocks until one appears —
  so the agent can idle *waiting for work* rather than being invoked.
- **Reproduction steps are validated, not trusted.** `propose_report` checks each step against the
  real event stream; steps with no supporting event are flagged **unverified** before a human sees
  them. A confidently-invented repro step sends an engineer to the wrong place, which is worse than
  no report at all.

---

## Quick start

Requires Node 20+.

```bash
git clone <this repo> && cd Traces

cd traces && npm install && npm run dev      # the app          → http://localhost:3000
cd ../bugbait && npm install && npm run dev # the broken demo  → http://localhost:3001
```

Open `localhost:3000`, pick one of the three bundled recordings, and connect an agent.

### Getting WebMCP in your browser

Traces needs `document.modelContext`, which isn't generally available yet. In descending order of
fidelity:

| Option | What you get |
|---|---|
| **Chrome 149+ / Edge 150+ with an [origin trial](https://developer.chrome.com/origintrials) token** | the real thing. Token is bound to an origin — register it for your deployed domain, and serve it as a **header** from `next.config.mjs`, not a meta tag, so it covers sub-resources |
| **WebMCP polyfill** (loads automatically in dev) | enough to build against; not enough to judge whether a schema is legible to a model |
| **`webmcp-tools` browser extension** | an inspector for calling the registered tools by hand |

Without any of these, Traces still works as an ordinary session replay player — the tools simply
aren't registered.

### Making your own recordings

`bugbait/` is a deliberately broken checkout app with three switchable bugs. Visit it with a flag,
reproduce the bug, and download the recording:

| URL | The bug |
|---|---|
| `localhost:3001/checkout?bug=empty-province` | `GET /api/provinces` returns `200` with `[]`; no empty-state handling, so validation fails and submit stays disabled behind a misleading message |
| `localhost:3001/checkout?bug=race` | the dropdown renders before its data arrives and never re-renders |
| `localhost:3001/checkout?bug=overlay` | the pay button is present and enabled but covered, so clicks never land |

The download lands as `<bug>.session.json`. To open it, use **Load a file…** — the last row of the
recording menu in the header, and a matching row under the three samples on the empty stage. You can
also drop the file anywhere on the empty stage. Nothing is uploaded, because there is nowhere to upload
to: the file is read in the tab and parsed into memory. The name becomes the recording's label, and a
slug of it becomes its id.

**Keep recordings of real users out of version control** — see
[T5](docs/threat-model.md#t5--a-real-user-session-ending-up-in-a-public-repository). Loading a file
never writes to `traces/public/recordings/`, so a recording you open stays out of the repository unless
you put it there yourself.

### Recording your own app

`npm i rrweb` and calling `record()` produces a file Traces will load and then serve badly. Five
options do the actual work, and `bugbait/src/lib/record.ts` is the reference implementation:

| Add this | What silently breaks without it |
|---|---|
| `checkoutEveryNms: 5000` | rrweb emits **one** full snapshot, at the start. The checkpoint index has a single entry, so every seek replays from the beginning — and `bisect`, which seeks repeatedly by design, pays that cost on each step. Nothing errors; the player just crawls |
| `maskAllInputs: true` | every keystroke is recorded verbatim. See below — this one is not a preference |
| a `window.fetch` patch emitting `addCustomEvent('network-request', …)` | `read_network` returns nothing. rrweb records DOM mutations, not requests; the network panel of a recording is whatever you put there yourself |
| normalising console events to `{ type: 3, source: 11 }` | the console plugin emits `{ type: 6, data: { plugin: 'rrweb/console@1' } }`, which nothing downstream reads. `consoleErrors` stays `0` on a session full of errors — the most misleading of the five, because zero looks like an answer |
| stamping `userAgent` onto the first Meta event | the session summary cannot say what browser it was |

**`maskAllInputs: true` is mandatory, not a preference.** rrweb records input values by default, so a
recorder without it is a credential logger: the password, the card number and the one-time code are all
in the JSON, in plain text, for anyone the file is later shared with. Traces truncates a `value` to 20
characters when a tool reads one, which limits what an agent sees and does nothing about what the file
contains. Mask at the recorder or accept that the recording is a secret.

**A gap worth knowing before you trust `read_network`:** a `fetch` patch sees `fetch` only.
`XMLHttpRequest` traffic — anything on axios's default adapter, jQuery, or an older SDK — is invisible
to it, and a recording of such an app will show an empty network timeline rather than an error. Every
fixture here uses `fetch`, so none of them expose this.

**The cost, measured** from the three files in `traces/public/recordings/`: 184–213 KiB for ~45 seconds
of a small checkout page, or roughly 4–5 KiB per second, at 209–223 events. A recording is JSON and
compresses well in transit; in memory it is the whole array. A ten-minute session of a heavier app is
plausibly tens of megabytes, which is what the 64 MB ceiling on a loaded file is sized for.

### Opening a recording you didn't make

Worth stating, since the feature above invites it. Scripts inside a recording **cannot execute**: the
replay iframe is sandboxed with `allow-same-origin` and not `allow-scripts`, so a `<script>` in the
captured DOM is inert markup. Sub-resources are a different matter — images, stylesheets and fonts
referenced by the recorded page **are fetched from their original URLs** when the DOM is rebuilt, which
tells those origins that the recording was replayed and when. The JSON itself is parsed in the tab and
goes nowhere; there is no upload endpoint to send it to.

---

## Project layout

```
Traces/
├── docs/
│   ├── architecture.md          how it's put together, and why
│   ├── tools.md                 the 16-tool contract
│   ├── agent-legible-dom.md     the DOM compressor spec
│   └── threat-model.md          what we defend against
├── traces/                       the app — this is the deployed URL
│   ├── public/recordings/       three synthetic samples
│   └── src/
│       ├── components/          player, timeline, agent panel
│       └── lib/
│           ├── replay/          rrweb wrapper + checkpoint index
│           ├── dom/             the compressor and differ
│           ├── bisect/          predicates + binary search
│           ├── webmcp/          registration, blocking gate, one file per tool
│           ├── store/           single state store, author on every action
│           └── report/          step validation against real events
└── bugbait/                     the deliberately broken demo app
```

`lib/replay`, `lib/dom`, and `lib/bisect` are **pure functions** — no React, no store, no knowledge
that WebMCP exists. That's what makes the interesting logic testable without a browser, and it's why
the compressor and the search algorithm have real tests while the UI does not.

There is **no backend**. No accounts, no database, no upload endpoint. The recording never leaves your
browser except as the small compressed slices an agent explicitly asks for.

---

## Security

Giving a language model influence over a live page deserves to be a design constraint rather than a
closing paragraph. The one-sentence version: **nothing that comes from the model is executed, and
nothing leaves the page that wasn't asked for.**

- **No `eval`, ever.** Predicates are structured objects from a closed set, each with its own
  evaluator. A test greps the source for `eval(` and `new Function` and **fails the build**, so this
  can't regress quietly under deadline pressure.
- **Tool arguments are untrusted input**, validated at the boundary like an HTTP body. Failures come
  back as readable tool errors, not thrown exceptions.
- **Budgets on every response**, because a tool returning 800 KB has denied service to every later
  call in the conversation — silently.
- **Personal data minimized by default**: `value` truncated to 20 characters, network bodies
  summarized (`"array, 0 items"`) and never forwarded whole, no backend to leak through.
- **Every committed recording is synthetic.**

Full analysis, including what is deliberately **out of scope**:
**[docs/threat-model.md](docs/threat-model.md)**.

---

## Built with

| Dependency | Licence | Why |
|---|---|---|
| [rrweb](https://github.com/rrweb-io/rrweb) + rrweb-player | MIT | records and replays DOM mutations; the only mature option that reconstructs a real DOM rather than pixels |
| [Next.js](https://nextjs.org) | MIT | prerendered pages, trivial Vercel deploy, response headers for the origin trial token |
| TypeScript | Apache-2.0 | strict mode; tool schemas and domain types stay honest |
| [Tailwind CSS](https://tailwindcss.com) | MIT | dense instrument UI without a component library |
| [zustand](https://github.com/pmndrs/zustand) | MIT | state readable and writable *from outside React* — see below |
| [IBM Plex Sans + Plex Mono](https://github.com/IBM/plex) | OFL-1.1 | one superfamily, so a mono timestamp and a sans label share a line without a step in it — `src/app/fonts.ts` |
| [vitest](https://vitest.dev) | MIT | the pure modules are tested; the UI is not |

Every dependency is permissively licensed and compatible with MIT redistribution. The fonts are the one
thing not in `package.json`: `next/font` fetches them during `next build` and serves them from this
origin, so the deployed bundle carries the woff2 files under OFL-1.1 — the licence text and the reserved
font names live with [the upstream project](https://github.com/IBM/plex/blob/master/LICENSE.txt), and
nothing here modifies or renames a face. We deliberately
avoided three tempting libraries: **DuckDB-Wasm** (it's the flagship example in the challenge's own
materials — using it would weaken the originality of the entry), **ffmpeg.wasm** (LGPL/GPL build
ambiguity we didn't want in an MIT repo), and **HyperFormula** (AGPL-3.0).

**Why zustand and not Context?** A tool's `execute()` is not a React component. The browser calls it
from outside the render tree, at arbitrary times, with no hooks available — and it needs to read state,
write state, and sometimes *wait for a human*. That requires imperative `getState()` / `setState()`
from outside the tree, which Context plus `useReducer` structurally cannot provide.

---

## Status and limitations

Stated plainly, because a README that oversells is worse than one that's short.

**Known limitations by design:**

- `bisect` assumes the predicate is **monotonic** in `[from, to]` — false, then true, once. A condition
  that flips repeatedly yields one transition point, not all of them.
- Predicates cover seven shapes. Anything outside them can't be expressed, on purpose.
- `read_dom_at` is lossy. It's meant to be: it answers *what state was this element in*, not *render
  this page for me*.
- Blocking tools depend on how long the agent host tolerates an unresolved call — a host-dependent
  number, which is why the ticket path exists.
- No authentication, no multi-tenancy, no rate limiting. This is a local-first tool.
- Recordings must be rrweb format. There's no importer for LogRocket or FullStory exports.

**Not attempted:** automated fixes, integration with issue trackers, replay of network responses,
mobile-native sessions.

<!-- BEFORE PUSHING: replace the live URL, the video link, and both measured character counts in
     "Making the DOM legible to a model". Update this Status section to reflect what actually
     shipped, and delete the work-in-progress note at the top of this file once it has. -->

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Three rules matter more than the rest: **nothing from the
model is ever executed**, **every tool response has a budget**, and **no real user recordings in this
repository**.

## Licence

[MIT](LICENSE) — © 2026 Riko, Vicko, Faiq and the Traces contributors.

The collective notice is deliberate: everyone who contributes keeps copyright over their own work,
and the licence covers all of it on the same terms. Git history is the authoritative list of who
contributed what — we don't maintain a separate `AUTHORS` file that inevitably falls out of date.

The name is literal, in two directions. A recorded session is a trace of what a person did; the binary
search an agent runs through it leaves a trace of its own — `bisectTrace` in the store, drawn on the
timeline as the playhead narrows in. Debugging here is following traces, both kinds.
