# Threat model

This project is an experiment in giving a language model influence over a live page. That is worth
treating as a design constraint from the first commit rather than a section added at the end, so
here is what we defend against and how.

The one-sentence version: **nothing that comes from the model is executed, and nothing leaves the
page that wasn't asked for.**

---

## Trust boundaries

```
 ┌─────────────────────────────────────────────┐
 │ The agent (untrusted input)                 │
 │  · tool arguments                           │
 │  · predicates, selectors, proposed steps    │
 └──────────────────┬──────────────────────────┘
                    │  validated at this line
 ┌──────────────────▼──────────────────────────┐
 │ Traces page (trusted)                        │
 │  · replay engine, DOM compressor, bisect    │
 │  · state store, author attribution          │
 └──────────────────┬──────────────────────────┘
                    │  budgeted, summarized
 ┌──────────────────▼──────────────────────────┐
 │ Back out to the agent                       │
 └─────────────────────────────────────────────┘
```

Tool arguments are **untrusted input** in the same sense that an HTTP request body is untrusted
input. They are validated at the boundary, and validation failures come back as readable tool errors
rather than thrown exceptions.

---

## Threats and mitigations

### T1 — The model sends code instead of data

A predicate is the obvious place to try to smuggle an expression: `disabled === true` is what a
developer would naturally write, and evaluating it would be one `eval` away.

**Mitigation.** Predicates are a closed set of seven structured shapes, each with its own TypeScript
evaluator. There is no code path that turns model output into executable code — no `eval`, no
`new Function`, no `setTimeout("...")`, no dynamic `import()` of a model-supplied string. A test greps
the source for `eval(` and `new Function` and **fails the build** if either appears, so this cannot
regress quietly during a rushed merge.

See [tools.md § Predicates](tools.md#predicates) for the grammar.

### T2 — Hostile or malformed selectors

**Mitigation.** Selectors are length-limited and validated by attempting to parse them before the
search starts, so an invalid selector is rejected up front rather than throwing on the third bisect
iteration. Selectors are only ever passed to `querySelector` against the replayed document; they
never reach `innerHTML` or any sink.

### T3 — Context flooding

An agent's context window is a resource, and a tool that returns 800 KB has effectively denied
service to every subsequent call in the conversation. This failure is *silent* — the agent keeps
answering, just worse.

**Mitigation.** Hard budgets everywhere, enforced by tests: 60 lines and 1,200 characters for
compressed DOM, 40 entries for `list_events`, 30 for `diff_dom`, 5 matches for `find_element`,
200 characters per console message. Truncation is always reported with a `truncated` flag and a
suggested next action.

### T4 — Personal data reaching the model

Session recordings of real users contain whatever those users typed: names, addresses, order
contents, sometimes worse.

**Mitigation.** The recording is never sent anywhere, in whole or in part, except as small compressed
slices the agent explicitly requests. Input `value` attributes are truncated to 20 characters.
Network response bodies are summarized — an array becomes `"array, 0 items"`, an object becomes its
key list — and never forwarded whole. There is no backend, so there is no upload path to get wrong.

### T5 — A real user session ending up in a public repository

The most likely way this project could actually harm somebody: someone tests it against a real site,
gets a useful recording, and commits it as a fixture.

**Mitigation.** Every recording in this repository is **synthetic**, produced by `bugbait/` — our own
deliberately-broken demo app, exercised by us. `.gitignore` blocks `*.session.json` outside
`traces/public/recordings/`, and this rule is stated in CONTRIBUTING.md because it's the kind of thing
a well-meaning contributor would otherwise do on their first PR.

If you fork this and point it at your own product, keep your recordings out of version control.

### T6 — Fabricated reproduction steps

A model asked for reproduction steps will produce plausible ones whether or not they happened. A bug
report with invented steps is worse than no bug report — it sends an engineer looking in the wrong
place with full confidence.

**Mitigation.** `propose_report` validates every step against the real event stream. Steps with no
supporting event are flagged **unverified** in the UI before a human can approve them. The guarantee
comes from the page, not from trusting the model.

### T7 — Unattributed changes

**Mitigation.** Every state mutation goes through an action, and every action carries
`author: "human" | "agent"`. The activity feed is the audit trail; every agent contribution can be
accepted, rejected, or undone individually. There is no path by which something appears on the
timeline without a recorded author.

### T8 — Duplicate tool registration

A page that re-registers its tools on every hot reload ends up exposing the same tool several times,
with older closures still live.

**Mitigation.** One global `AbortController`; registration happens once; `abort()` on unmount.

---

## What is deliberately out of scope

Stated plainly, because a threat model that implies more coverage than it has is worse than a short
one:

- **No authentication or authorization.** Traces is a local-first tool with no accounts and no
  multi-tenancy. If you deploy it somewhere shared, that is your boundary to draw.
- **No hardening of the replayed page's own content.** Recordings are replayed inside rrweb's iframe;
  we treat that content as untrusted for *reading*, but we do not attempt to sandbox arbitrary
  malicious recordings. Don't load recordings from people you don't trust.
- **No rate limiting.** An agent can call `bisect` in a loop. On a local single-user tool the cost of
  that is your own CPU.

---

## Reporting something

If you find a way to get model-supplied input executed, or to get data out of a recording that the
human never approved, please open an issue. This is a hackathon-scale project with no production
users, so there's no embargo process — just tell us in the open.
