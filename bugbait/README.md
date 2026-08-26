# bugbait

A small, ordinary-looking shop with three deliberate bugs. It exists for one reason: to produce the
session recordings that [Traces](../README.md) investigates.

Every bug is armed by a query parameter — `/?bug=empty-province` — because **a bug that only
reproduces on one machine is not a fixture, it is a story.** Anyone cloning this repo has to be able to
produce the same session we did, or the sample recordings become magic artefacts nobody can regenerate,
and the moment one of them needs re-recording the demo is gone.

Each bug is also chosen to be **invisible in the DOM at the moment it matters**. Reading the final DOM
tells you the Pay button is disabled. It does not tell you that a request sixteen seconds earlier
returned `200` with an empty array, and no amount of looking at the end state recovers that. That gap is
the entire argument of the project, so please treat it as a property to preserve rather than a detail.

---

## The three bugs

| `?bug=` | What the shopper sees | What actually happened | The tool that finds it |
|---|---|---|---|
| `empty-province` | The province dropdown is empty. Submit stays disabled and the error blames the postcode. | `GET /api/provinces` returned **200 with `[]`** at ~11.6s. There is no empty-state handling, so a select with zero options is treated as the truth. | `read_network` (`"array, 0 items"`), then `bisect` on `optionCount: 0` |
| `race` | The city dropdown stays empty even though the data loaded. | The option list is captured into state on the component's first render — before the fetch resolves — and never re-read. The endpoint is perfect: 200, six cities, in 912ms. | ordering: `find_element` says the select existed at 28s, `read_network` says the data arrived at 29.9s |
| `overlay` | Clicking Pay does nothing. No error, no spinner, no request. | `#promo-strip` covers `#pay` at `z-index: 20` and `opacity: 0.03` — a fade-in that never completed. Clicks land on the strip. | `measure_layout` occlusion — a visual bug found without pixels |

Two things worth noticing about how these are built:

- **The armed scenario never appears in the recording.** `?bug=` is read once on arrival and then removed
  from the address bar (`armScenario` in `src/lib/bugs.ts`), because rrweb stamps `location.href` into
  every Meta event and `read_session_meta` hands those URLs straight to the agent. The stub endpoints
  are told which scenario is armed through a request header, which is not recorded, so the URL in the
  network log stays `/api/provinces?country=ID`. The URL you *type* is unchanged, so reproducibility
  costs nothing.
- **The recorder control is not in the capture.** The panel unmounts before recording starts, which is
  why stopping is a keyboard shortcut. An agent that finds a "Download recording" button in the replay
  will reason about it, and `blockClass` does not help — rrweb still records a same-sized placeholder.

The 3% opacity on the overlay is deliberate: it is invisible to a human watching the replay too. That
bug cannot be solved by asking a person to look, only by measuring two boxes.

---

## Recording a session by hand

Takes about a minute per bug once the server is up.

### 1. Serve a production build

```bash
cd bugbait
npm install
npm run build && npm start          # http://localhost:3001
```

**Not `npm run dev`.** React StrictMode double-invokes effects in development: the provinces request
fires twice, and the state initialiser the `race` bug depends on losing gets a second chance to win. The
bug would sometimes not reproduce, which is the worst property a fixture can have. The development-only
"armed:" banner is also absent from a production build, which is what you want in a capture.

### 2. Arm the bug and start recording

Open `http://localhost:3001/?bug=empty-province` (or `race`, or `overlay`).

The recorder panel is bottom-right. It names the armed scenario, and it also has links for switching
scenario — those links live in the panel rather than on the page so they are never captured. Press
**Start recording**. The panel disappears; that is correct.

### 3. Drive the session

The timings below are the ones the sample recordings use. They are not arbitrary: the cause lands at
~11.6s and the symptom does not appear until ~28s, and that ~16-second gap is what `bisect` is measured
against. Approximate them and the recording is fine; skip the cart entirely and you lose the navigation
that makes `read_session_meta` useful.

**Everyone, first 28 seconds:**

| ~time | Do this |
|---|---|
| 0–8s | On the cart: bump a quantity up, bump another up, bump one back down. Watch the total change. |
| 10s | Click **Continue to checkout**. (The provinces request fires here and resolves at ~11.6s.) |
| 13s | Type a name. |
| 17s | Type a street address. |
| 23s | Type a five-digit postcode. |
| 28s | Click **Continue**. The Region and payment section appears — this is the first moment `#province` exists. |

**Then, `empty-province`:** click the empty province dropdown a couple of times. Type a 16-digit card
number; the error appears under the postcode once the card is complete. Click the province dropdown a few
more times in frustration, then **do what the error tells you** — clear the postcode and retype a
different one. Try Pay. Give up around 46s.

**Then, `race`:** pick a province (it works). Click the city dropdown twice — nothing in it. Type the
card number. Pick a *different* province, which re-requests the cities successfully, and click the city
dropdown again; still empty. Retype the postcode. Give up around 46s.

**Then, `overlay`:** pick a province, pick a city, type the card number. Pay becomes enabled. Wait until
about 32s — four seconds after the section appeared — then click **Pay** four or five times in quick
succession, pause, and click twice more. Nothing happens, every time.

### 4. Stop and save

Press **Ctrl + Shift + .** — the panel reappears with the counts. Click **Download recording**, which
saves `<bug>.session.json`.

Before trusting the take, check the panel's numbers:

- **duration** ~45s
- **full snapshots** and **meta events** should be roughly one per five seconds (8–9 for a 45s take) and
  **equal to each other**. rrweb emits them in pairs, and the replayer's seek fast path scans backwards
  for the last Meta event — snapshots without Meta events make every bisect probe replay from zero,
  which shows up as "bisect is slow" rather than as a bad recording.

Then move the file into `traces/public/recordings/`, named for the bug:

| bug | file |
|---|---|
| `empty-province` | `empty-province.json` |
| `race` | `race-condition.json` |
| `overlay` | `overlay-blocks-button.json` |

---

## Regenerating the sample recordings with a script

The three files currently in `traces/public/recordings/` are **scripted fixtures, not human sessions**,
and each says so in its own `label` field. They were produced by:

```bash
npm run build && npm start           # one terminal
npm run record:fixtures              # another
```

`scripts/record-fixtures.mjs` drives a real installed Chrome through the procedure above and clicks the
same two buttons a person clicks. Everything in the output is real — real browser, real build, real
`rrweb.record()`, real HTTP, real layout and CSS. What is synthetic is the *hand*: the clicks and
keystrokes come from a timeline instead of from a person, which is what makes them reproducible to the
millisecond.

Keep the distinction. A person hesitates, misreads the error, and tries the wrong fix, and that is the
session worth recording for a demo video. Re-record by hand when the recording is the thing being shown;
use the script when the recording is the thing being measured.

It needs no browser download — `playwright-core` drives the Chrome or Edge you already have. Set
`BUGBAIT_CHROME` if it lives somewhere unusual.

---

## What the file looks like

A download is `{ id, label, events, startedAt, durationMs, meta }`, mirroring `Recording` in
`traces/src/types/domain.ts`.

One thing to know: **`loadRecording(id, label, raw)` takes the bare event array, not the wrapper.** Pass
`json.events`:

```ts
const json = await (await fetch(`/recordings/${slug}.json`)).json()
const recording = loadRecording(slug, json.label, json.events)
```

The wrapper is kept because the recording picker needs a human-readable label per file, and this is the
only place one can live. Everything else in `meta` is derived from the events by `loadRecording` itself,
so there is nothing there to disagree with.

`userAgent` is the exception, and it is stored twice on purpose: rrweb records it nowhere, so the
recorder writes it into the wrapper's `meta` *and* onto every Meta event, where `loadRecording` reads it
opportunistically. That way a recording reports a real user agent even if only the event array survives.

---

## Rules for anything recorded here

- **Inputs are masked.** `maskAllInputs: true` records that a field was typed into and how many
  characters, never the value. This is a checkout form; see [T4](../docs/threat-model.md).
- **Nothing external is ever contacted.** Both endpoints are Next.js route handlers inside this app, so
  a recording is self-contained and no third party appears in it.
- **The mechanism is never logged.** The only console output any bug produces is the same misleading
  validation line the shopper sees. A recording that contains the answer in plain text turns the
  investigation into a reading exercise.
- **Never commit a recording of a real site or a real person.** A recording is a full reconstruction of a
  page and everything on it. Every file in `traces/public/recordings/` comes from this app;
  [T5](../docs/threat-model.md) is about the one way this project could actually harm somebody.
