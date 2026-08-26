# Working in this repository

Notes for whoever — or whatever — writes code here. If you are an AI coding agent, read this file
before your first edit, then `CONTRIBUTING.md`.

## Read in this order

1. **`CONTRIBUTING.md`** — the three non-negotiable rules, code conventions, testing policy
2. **`docs/architecture.md`** — how the pieces fit, including the module-level engine handle
3. **`docs/tools.md`** — the 16-tool contract
4. **`docs/agent-legible-dom.md`** — only if you touch `lib/dom`

## Stay inside the folders you own

This started as a three-person project split **by folder**, not by feature, so that concurrent work
never lands on the same lines:

| Area | Owner |
|---|---|
| `traces/src/lib/replay` `lib/dom` `lib/bisect` `lib/report` `src/types/domain.ts` | Riko |
| `traces/src/components` `src/app/page.tsx` `src/app/layout.tsx` `globals.css` `tailwind.config.ts` | Faiq |
| `traces/src/lib/webmcp` `src/lib/store` `src/app/tool-surface.tsx` `bugbait/` | Vicko |

If the change you need lives in someone else's folder, **say so in your final message instead of
making it.** An agent that helpfully fixes a neighbouring folder hands its owner a merge conflict they
have to resolve blind, in code they didn't write.

`src/types/domain.ts` is the frozen contract all three depend on. Adding a type there is a
conversation, not a commit.

## `TODO(name), Day n:` markers are assignments

Every stub in this repository names its owner and the day it is due. Implement the ones addressed to
you. Leaving someone else's stub alone is correct behaviour, not incompleteness — and deleting the
marker while implementing around it destroys the only record of who owes what.

## Some tests are red on purpose

`compress-dom`, `bisect`, and `evaluatePredicate` ship with failing tests. They were written first, as
specifications. **Never** make them pass by weakening an assertion, adding `.skip`, or deleting a case:
that converts a specification into a lie, silently.

`no-eval.test.ts` greps the source and fails if `eval(` or `new Function` appears anywhere. It is a
security boundary, not a lint rule.

## `internal/` is gitignored deliberately

It holds Indonesian planning documents for the original team. Don't add it to git, don't translate it
into the public docs, and don't quote it in public files. If it isn't in your clone, that's expected —
ask the person who gave you the repository.

## Verify instead of asserting

Dependencies may not be installed in a fresh clone, so nothing has typechecked yet:

```bash
cd traces && npm install && npx tsc --noEmit && npm test
```

Run that before claiming a change compiles. For tools specifically, "it works" means called from the
`webmcp-tools` inspector *and* from a real agent — see `CONTRIBUTING.md` § Testing a tool. A tool can
be correct and still be unusable because a model misreads its schema.
