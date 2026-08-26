# Agent-legible DOM

The single most important design decision in Traces, and the one that took the longest to get right.

---

## The problem

A real application page is 200–800 KB of HTML. If `read_dom_at` returned that, one tool call would
consume most of an agent's context window and the product would be dead on its first call — not
with an error, but with a plausible-looking response that quietly poisons everything after it.

So no tool in Traces ever hands the agent raw DOM. Every DOM-reading tool returns a **compressed
representation designed to be read by a language model**: the interactive and state-bearing structure
only, with relevant attributes, truncated text, and explicit visibility.

```
form#checkout [visible]
  input[name=email] value="ana@..." [valid]
  input[name=card] value="" [invalid] aria-invalid=true
  select[name=province] [empty options: 0]
  button[type=submit] "Pay" [DISABLED]
  div.error "Province is required" [visible]
```

Six lines. Everything an agent needs to conclude that the province list is empty, that the form is
therefore invalid, and that the submit button is consequently disabled — and nothing else.

---

## Inclusion rules

A node is included if it satisfies **at least one** of:

1. **It is interactive** — `input`, `button`, `select`, `textarea`, `a[href]`, `[role]`, `[onclick]`,
   `[tabindex]`.
2. **It carries state** — `disabled`, `aria-invalid`, `aria-disabled`, `hidden`, `readonly`,
   `required`, `checked`, `aria-expanded`.
3. **It has meaningful short text** — direct text content of 60 characters or less after trimming.
   Labels, validation messages, button text.
4. **It is a container with at least one surviving child** under rules 1–3.

Everything else is discarded, subtree included: layout wrappers, styling spans, `svg`, `script`,
`style`, comments, and — importantly — containers whose entire subtree failed the filter. Dropping a
wrapper is cheap; dropping a wrapper *and its 400 descendants* is where the compression ratio
actually comes from.

## Attribute rules

A **whitelist**, not a blacklist. Blacklists lose this argument over time; every new framework
invents another attribute nobody thought to exclude.

| Included | Notes |
|---|---|
| `id`, `name`, `type`, `role` | identity and semantics |
| `href` | truncated to 40 characters |
| `value` | truncated to 20 characters |
| `placeholder`, `aria-label` | often the only label an element has |
| `disabled`, `checked`, `required`, `readonly`, `hidden` | state |
| `aria-invalid`, `aria-expanded` | state a human would read off the screen |

`class` is excluded, with one exception: a single short class that looks semantic (`.error`,
`.warning`) is kept, because it is frequently the only clue that a `div` is a validation message.
A full Tailwind utility list is never included — it is pure token cost and zero signal.

## Special annotations

Some conditions are worth stating outright rather than leaving the agent to infer:

- `select` with zero `option` children → `[empty options: 0]`. An agent looking at a `select` with no
  children rendered has no reliable way to distinguish "empty" from "collapsed", and this is a common
  real bug class.
- `display: none`, `visibility: hidden`, or zero size → `[hidden]`.
- `[visible]` is emitted on the scope root only, not per line. Repeating it on every row would cost
  more tokens than it conveys.

## Hard budget

| Limit | Value | Behaviour when exceeded |
|---|---|---|
| Lines | **60** | truncate, append `… N nodes omitted (narrow the scope)` |
| Characters | **1,200** | same |
| Depth | 6 levels | flatten the remainder |

These are **tests**, not intentions. `compress-dom.test.ts` and `compress-dom.budget.test.ts` hold the
budget against fixtures built to break it, and `compress-dom.recordings.test.ts` counts lines and
characters at every full snapshot of all three sample recordings and fails if either budget is
exceeded. A budget enforced by discipline erodes in a week; a budget enforced by CI does not.

When truncation happens, the message tells the agent what to do about it (`narrow the scope`) rather
than just reporting that something was cut. Agents act on instructions far more reliably than on
observations.

---

## Why the constraint made the design better

WebMCP tools return a `content` array, and today only `"text"` is specified — an `"image"` content
type remains an open question in the spec. We could not send screenshots even if we wanted to.

That turned out to be the more interesting constraint to design against:

- A screenshot costs thousands of tokens and still leaves the agent inferring state from pixels. It
  cannot read `aria-invalid`. It cannot count `option` elements that aren't rendered. It cannot tell
  a disabled button from a greyed-out one.
- The compressed representation costs a few hundred tokens and states all three directly.

Where pixels genuinely are the answer — *does this dropdown look broken, or normal but empty?* — we
don't guess. The agent calls [`ask_human_visual`](tools.md#12-ask_human_visualquestion-expects-choices)
and a person clicks the moment on the player. The agent gets a timestamp back, not an adjective.

Two different problems, two different mechanisms, neither pretending to be the other.

---

## Measuring it

The compression ratio is a headline claim, so it is measured rather than asserted, and the
measurement script lives in the repo so anyone can reproduce the numbers:

```bash
cd traces && node scripts/measure-compression.mjs
```

The script rebuilds a **genuine rrweb FullSnapshot** out of each sample recording with
`rrweb-snapshot`'s `rebuild()` — the same serializer the replayer uses — into a jsdom document, and
compresses the real scope root the DOM tools use on this app, `form#checkout`. No mutations are
replayed and no markup is hand-written, so the tree measured is exactly what rrweb captured at that
timestamp. Each recording's critical instant is chosen by a predicate the script prints, not by hand.

At the critical instant of the `empty-province` recording — **38,048 ms**, the moment the province
dropdown is empty, `aria-invalid` is set on the postcode and the error text has appeared:

| | Characters |
|---|---|
| Raw `outerHTML` of the scope (`form#checkout`) | 2,026 |
| `read_dom_at` response | 663 |

**3.06×**, and 25 elements rendered as 17 lines. `compressDom` itself cost 2–9 ms. All three samples,
each at its own critical instant:

| recording | instant | raw scope | response | lines | ratio |
|---|---|---|---|---|---|
| `empty-province` | 38,048 ms | 2,026 | 663 | 17 | 3.06× |
| `race-condition` | 28,048 ms | 2,397 | 896 | 30 | 2.68× |
| `overlay-blocks-button` | 38,633 ms | 2,720 | 1,058 | 37 | 2.57× |

Nothing was truncated and every response is inside both budgets, at every full snapshot of all three
recordings — that is `compress-dom.recordings.test.ts`, not just this script.

Four things to be careful about when quoting these numbers:

- **The ratio is a property of the page, not of the algorithm.** The output side is capped at 1,200
  characters, so a heavier page produces a bigger ratio for free. `bugbait`'s checkout is deliberately
  small — 25 to 45 elements, no deep wrapper chains — so ~3× is the honest reading of *this* page.
  Extrapolating it to "hundreds of thousands of characters become nine hundred" is not, because no
  page that size has been measured here.
- **An earlier figure of 9.84× is superseded.** It was taken in a browser against a page whose markup
  merely *mirrored* the demo app's checkout, and that page was over five times heavier than the real
  one (11,350 characters of scope against 2,026). Same function, different page — which is exactly the
  previous bullet, and the reason the number now comes from a script anyone can re-run against the
  checked-in recordings.
- **jsdom implements no layout**, so `[hidden]` here reflects the `hidden` attribute only, never CSS.
  Checked rather than assumed: wiring jsdom's own `getComputedStyle` in as a global produces
  byte-identical output at all three instants, because nothing inside `form#checkout` is CSS-hidden.
  Geometry and occlusion are `measureLayout`'s job and are not part of this measurement.
- **Where the budget actually binds is `option` lists.** The three responses use 17, 30 and 37 of 60
  lines, and almost all of the difference is the province and city dropdowns once they are populated.
  On this form — about 17 lines of structure before any options — a single `select` with 45 options
  would cross the line limit and engage truncation. That path is tested, but it is worth knowing
  before pointing `read_dom_at` at a country dropdown.

