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

These are **tests**, not intentions. `compress-dom.test.ts` measures line and character counts
against all three sample recordings and fails if either budget is exceeded. A budget enforced by
discipline erodes in a week; a budget enforced by CI does not.

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

The compression ratio is a headline claim, so it is measured rather than asserted. At the critical
instant of the `empty-province` recording — the moment the required dropdown is empty, `aria-invalid`
is set and the error text has appeared:

| | Characters |
|---|---|
| Raw `outerHTML` of the scope | 11,350 |
| `read_dom_at` response | 1,154 |

**9.84×**, and 140 elements rendered as 20 lines. Repeated at four other instants of the same
recording the ratio held between 9.5× and 10.0×, and the response stayed inside both budgets every
time (1,154–1,191 characters, 20–21 lines). `compressDom` itself cost 2.1–7.6 ms.

Two things to be careful about when quoting these numbers:

- **The ratio is a property of the page, not of the algorithm.** The output side is capped at 1,200
  characters, so a heavier page produces a bigger ratio for free. A ~9.8× measurement on a page with
  140 elements is the honest reading; extrapolating it to "hundreds of thousands of characters
  become nine hundred" is not, because no page that size has been measured here.
- **They were taken in a browser, against a real rrweb replay** — the DOM that comes back out of the
  replay iframe, not a test fixture. That distinction turned out to matter by a factor of four: the
  same function measured against hand-written jsdom fixtures reported 2.2×, because a fixture has
  none of the wrapper depth a real page carries. jsdom also implements no layout, so nothing about
  visibility can be measured there at all.

The measurement is not yet reproducible from a checked-in script, because it needs a browser, a real
Replayer and a recording to replay: it was taken from a harness outside the repo, driving a page
whose markup mirrors the demo app's checkout. Once the sample recordings land, this becomes a page
in the app rather than an external harness — the numbers above should be re-taken against the real
`empty-province` sample at that point, and they will move, because the page will not be identical.
