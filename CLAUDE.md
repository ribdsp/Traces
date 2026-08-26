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

Every stub names the person who owned it and the day it was due during the original build. Implement
the ones you were asked to implement; leaving the rest alone is correct behaviour, not incompleteness.
Deleting a marker while implementing around it destroys the only record of who owes what.

## Some tests are red on purpose

`compress-dom`, `bisect`, and `evaluatePredicate` ship with failing tests. They were written first, as
specifications. **Never** make them pass by weakening an assertion, adding `.skip`, or deleting a case:
that converts a specification into a lie, silently.

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
