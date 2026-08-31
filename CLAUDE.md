# Working in this repository

Notes for whoever — or whatever — writes code here. If you are an AI coding agent, read this file
before your first edit, then `CONTRIBUTING.md`.

## Read in this order

1. **`CONTRIBUTING.md`** — the three non-negotiable rules, code conventions, testing policy
2. **`docs/architecture.md`** — how the pieces fit, including the module-level engine handle
3. **`docs/tools.md`** — the 16-tool contract
4. **`docs/agent-legible-dom.md`** — only if you touch `lib/dom`

## One area per change

The codebase is split **by folder, not by feature**, so that concurrent work rarely lands on the same
lines. Two consequences:

- **Keep a change inside the area you were asked to work on.** If the fix you need lives elsewhere,
  **say so in your final message instead of making it.** A patch that helpfully repairs a neighbouring
  module hands its maintainer a conflict to resolve blind, in code they didn't write.
- **`src/types/domain.ts` is a frozen contract.** Every other module depends on it, which makes adding
  a type there a conversation rather than a commit.

Who holds which area isn't listed here on purpose: it changes, and a stale ownership table is worse
than none. Whoever asked you to make this change will tell you your scope.

## `TODO(name), Day n:` markers are assignments

One stub is left, and it still carries its marker. `registerDynamicTool` in
`traces/src/lib/webmcp/register-tools.ts:133` throws `registerDynamicTool: not implemented`, and nothing
in the codebase calls it — so promoting a hypothesis does not grow a 17th tool. The convention is
documented here because the rule outlives the markers: a marker names the person who owned the work and
the day it was due, so **deleting one while implementing around it destroys the only record of who owes
what.** If you add a marker, name yourself in it. If you find one, either implement it or leave it
exactly where it is.

## The tests are green, and two suites must stay honest

All 303 tests pass. That is worth stating because of how some of them got there: the `compress-dom`,
`bisect` and `evaluatePredicate` suites were written first, as specifications, and were red for as long
as it took the implementations to satisfy them. **Never** make a test in those suites pass by weakening
an assertion, adding `.skip`, or deleting a case: that converts a specification into a lie, silently. A
red test there means the implementation is wrong.

`no-eval.test.ts` greps the source and fails if `eval(` or `new Function` appears anywhere. It is a
security boundary, not a lint rule.

## Verify instead of asserting

Dependencies may not be installed in a fresh clone, so nothing has typechecked yet:

```bash
cd traces && npm install && npx tsc --noEmit && npm test
```

Run that before claiming a change compiles. For tools specifically, "it works" means called from the
`webmcp-tools` inspector *and* from a real agent — see `CONTRIBUTING.md` § Testing a tool. A tool can
be correct and still be unusable because a model misreads its schema.
