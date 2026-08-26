# Architecture

How Traces is put together, and why the non-obvious choices are the way they are.

---

## Repository shape

One git root, two Next.js apps.

```
Traces/
├── LICENSE                  MIT
├── README.md
├── CONTRIBUTING.md
├── docs/
│   ├── architecture.md          this file
│   ├── tools.md                 the 16-tool contract
│   ├── agent-legible-dom.md     the DOM compressor spec
│   └── threat-model.md
├── traces/                   the app itself — the deployed URL
└── bugbait/                 a deliberately broken checkout app + rrweb recorder
```

`bugbait` exists to produce recordings. Keeping it in the same repository means anyone can regenerate
the sample data instead of trusting fixtures they can't reproduce; deploying it to a separate origin
means the recordings have a realistic foreign origin rather than being self-referential.

---

## `traces/`

```
traces/
├── next.config.mjs                  Origin Trial header lives here
├── public/recordings/
│   ├── empty-province.json          primary sample
│   ├── race-condition.json          second sample
│   └── overlay-blocks-button.json   third sample, a purely visual bug
└── src/
    ├── app/
    │   ├── layout.tsx               mounts the tool surface, once
    │   ├── tool-surface.tsx         the client component that registers and reports status
    │   ├── page.tsx                 the two-panel shell plus the shared timeline
    │   └── globals.css
    ├── components/
    │   ├── player/
    │   │   ├── replay-stage.tsx         hosts the rrweb Replayer
    │   │   ├── mark-point-overlay.tsx   click-to-mark, for ask_human_visual
    │   │   └── player-controls.tsx
    │   ├── timeline/
    │   │   ├── timeline.tsx
    │   │   ├── event-track.tsx          clicks, navigation, errors, failed requests
    │   │   ├── bisect-trace.tsx         animates the binary search
    │   │   └── annotation-marker.tsx    agent-authored markers
    │   ├── agent/
    │   │   ├── agent-lane.tsx           where a human drops a task
    │   │   ├── activity-feed.tsx        who did what, in order
    │   │   ├── hypothesis-cards.tsx     promote / demote / reject
    │   │   ├── ask-human-visual-prompt.tsx
    │   │   └── report-draft.tsx
    │   └── ui/
    │       ├── author-badge.tsx          human or agent, on every contribution
    │       └── tool-status-banner.tsx    native / polyfill / unavailable, said out loud
    ├── lib/
    │   ├── replay/
    │   │   ├── load-recording.ts        parse and validate rrweb events
    │   │   ├── checkpoint-index.ts      full-snapshot positions, for fast bisect
    │   │   ├── replay-engine.ts         Replayer wrapper: gotoTime, mirrorDocument
    │   │   └── event-digest.ts          the interesting events only
    │   ├── dom/
    │   │   ├── compress-dom.ts          see docs/agent-legible-dom.md
    │   │   ├── compress-dom.test.ts     budget enforcement
    │   │   ├── diff-dom.ts
    │   │   └── measure-layout.ts
    │   ├── bisect/
    │   │   ├── predicate.ts             closed set + validator
    │   │   ├── predicate.test.ts
    │   │   ├── bisect.ts
    │   │   ├── bisect.test.ts
    │   │   └── no-eval.test.ts          greps the source; fails the build on eval or new Function
    │   ├── webmcp/
    │   │   ├── tool-types.ts            response helpers and the schema type
    │   │   ├── register-tools.ts        every registerTool call, one place
    │   │   ├── blocking.ts              the human-in-the-loop gate
    │   │   ├── polyfill.ts
    │   │   └── tools/                   one file per tool, 16 of them, plus index.ts and registry.test.ts
    │   ├── store/session.ts             single state store
    │   └── report/build-report.ts       reconstructs steps from real events
    └── types/
        ├── domain.ts                    the frozen contract
        └── webmcp.d.ts                  ambient document.modelContext
```

`lib/replay`, `lib/dom`, and `lib/bisect` are **pure functions**: data in, data out. They don't touch
React, they don't touch the store, and they don't know WebMCP exists. `lib/webmcp/tools/*` are thin
wrappers over them. Components only read the store and dispatch actions.

That layering isn't architectural taste — it's what makes the interesting parts unit-testable without
a browser, and it's why the DOM compressor and the bisect algorithm have real tests while the UI does
not.

---

## `bugbait/`

```
bugbait/src/
├── app/page.tsx              cart
├── app/checkout/page.tsx     the checkout form, source of every bug
└── lib/
    ├── record.ts             rrweb.record() → "download recording"
    └── bugs.ts               ?bug=empty-province | race | overlay
```

| Flag | The bug | What the agent has to figure out |
|---|---|---|
| `empty-province` | `GET /api/provinces` returns `200` with body `[]`; the UI has no empty-state handling, so validation fails and submit stays disabled with a misleading message | the `select` has 0 options from ~28.4s; the request at ~12s is the cause |
| `race` | the dropdown renders before its data arrives and never re-renders | the ordering: DOM ready *before* the response |
| `overlay` | the pay button is covered by another element, so clicks never land | `measure_layout` reports occlusion — a visual bug found without pixels |

---

## Data flow

```
rrweb JSON
   │ load-recording()   ── validate event shapes
   ▼
events[] ──► checkpoint-index()   ── position of every full snapshot
   │
   ├──► event-digest()   ── short list of anomalies  ──► list_events
   │
   └──► replay-engine (rrweb Replayer, same-origin iframe)
              │
              ├── gotoTime(t) ──► mirrorDocument() ──► compress-dom() ──► read_dom_at
              │                                            └──► diff-dom() ──► diff_dom
              │
              └── bisect(predicate, from, to)
                    └── ~6×: nearest checkpoint → gotoTime → evaluate predicate
                                                                    ▲
                                                          predicate.ts (closed set)
```

One detail that is easy to get wrong: `compress-dom()` operates on the **replayed document inside the
Replayer's iframe**, not on Traces's own DOM. That access is same-origin because the iframe is created
by the Replayer itself rather than loading a remote URL.

The engine instance is published through `setActiveEngine()` / `getActiveEngine()` in
`replay-engine.ts`: `ReplayStage` creates it on mount, and every tool that needs to replay to a moment
collects it from there. It is a module-level handle rather than store state, because nothing renders
from it and per-contribution undo over a live Replayer is meaningless. Tools must handle `null` — the
page can be asked a question before the stage has mounted.

### How `bisect` stays fast

Naively, evaluating a predicate at time `t` means replaying from zero. Six iterations of that on a
47-second recording is unusable.

rrweb emits periodic full snapshots. `checkpoint-index.ts` records where they are at load time, so
each probe replays from the nearest preceding checkpoint rather than from the beginning. Six to eight
iterations complete in well under two seconds, and `elapsedMs` is reported in the tool response so
the number is never a claim.

---

## State: why it's imperative, not just React

A tool's `execute()` is **not a React component**. The browser calls it from outside the render tree,
at any time, with no hooks available. It has to read current state, write state, and sometimes *wait
for a human*.

So the store needs imperative access from outside React — `getState()` and `setState()`. Zustand
provides that without ceremony; Context plus `useReducer` cannot, because both only exist inside the
tree.

```ts
type SessionState = {
  recording: Recording | null
  checkpoints: number[]
  currentTime: number
  markers: Marker[]           // { id, timestamp, label, severity, author }
  hypotheses: Hypothesis[]    // { id, text, confidence, evidence[], status, author }
  tasks: Task[]
  activity: ActivityEntry[]
  pendingAsk: AskHumanVisual | null
  bisectTrace: BisectStep[]
}
```

Two rules on top of it:

1. **Every mutation goes through an action, and every action carries `author`.** Get this right and
   the activity feed — the thing that makes agent contributions distinguishable from human ones — is
   correct for free, forever, including for code written later by someone who never read this
   document.
2. **Actions return new objects rather than mutating.** Per-contribution undo requires previous states
   to still be intact.

---

## Human-in-the-loop: the blocking gate

Four tools don't resolve until a person acts. The mechanism is deliberately small:

```ts
export function createGate<T>(timeoutMs: number) {
  let settle: ((value: T) => void) | null = null
  const promise = new Promise<GateResult<T>>((resolve) => {
    settle = (value) => resolve({ status: 'answered', value })
    setTimeout(() => resolve({ status: 'pending' }), timeoutMs)
  })
  return { promise, resolve: (v: T) => settle?.(v) }
}
```

1. `execute()` opens a gate, puts the request in the store, and awaits it.
2. The UI renders the prompt. The human acts, which calls `gate.resolve(...)`.
3. If the timeout fires first, the tool **still returns** — `{ status: "pending", ticket }` — rather
   than leaving the call unresolved until the host gives up on it.
4. The agent calls the same tool again with the ticket to collect the answer.

The timeout value is an empirical question, not a preference: **how long will an agent host tolerate
an unresolved tool call?** That determines whether the ticket path is a fallback or the primary
mechanism, and it's worth measuring against your target host before building on top of it.

---

## Tool registration lifecycle

- Registered once in `layout.tsx`, in a run-once effect — not per render.
- One global `AbortController`; `abort()` on unmount, so hot reload can't leave duplicate tools
  behind.
- Tools that need a loaded recording stay registered anyway and return a readable error when there
  isn't one. An agent given *"No recording loaded. Ask the human to drop a recording file"* will relay
  that to the user, which is far more useful than a tool surface that changes shape underneath it.
- **Dynamic registration.** Once a hypothesis is promoted, Traces can register a new tool specific to
  that finding — `verify_hypothesis_1` — so the tool surface evolves in response to what was
  discovered. This uses `toolchange` and the same `AbortController` machinery.

---

## Deployment

| What | Where | Notes |
|---|---|---|
| `traces/` | Vercel, production domain | the URL people actually use |
| `bugbait/` | Vercel, separate subdomain | recording source |

WebMCP is available behind an origin trial in Chrome 149+ and Edge 150+, and the trial token is bound
to an origin. Register it for the **production domain**, not just localhost, and serve it as a header
from `next.config.mjs` rather than a meta tag — headers apply to sub-resources too.

For local development without trial access, `lib/webmcp/polyfill.ts` loads the WebMCP polyfill, and
the `webmcp-tools` browser extension gives you an inspector for the registered tool surface. Testing
against the inspector is not optional: a tool that works when called from your own code can still
have a schema that a model consistently misreads.
