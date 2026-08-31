# Security Policy

Traces hands a language model influence over a running page, so the security posture is a design
constraint here rather than a checklist. The reasoning, the trust boundaries, and the things
deliberately left out of scope are all in [docs/threat-model.md](docs/threat-model.md) — read that
first if you want to know what this project already considers an attack.

This file is the short version, plus how to tell us.

## Supported versions

There is one supported version: whatever is on `main`. There are no release branches and no
backports.

| Version | Supported |
|---|---|
| `main` | ✅ |
| Anything else | ❌ |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private reporting:
[**Report a vulnerability**](https://github.com/ribdsp/Traces/security/advisories/new). It creates a
private thread visible only to you and the maintainers.

If that link is unavailable, contact [@ribdsp](https://github.com/ribdsp) on GitHub and say only that
you have a security report — no details in a public channel.

What helps:

- The tool name, if a WebMCP tool is involved, and the exact arguments
- Which WebMCP mode you were in: real origin trial, the polyfill, or the `webmcp-tools` inspector
- Browser and version
- Whether the input came from a model, a human, or a recording file
- What you expected the boundary to be, and what actually happened

What to expect: this started as a hackathon project and is maintained on a best-effort basis. You will
get an acknowledgement, and a real answer rather than a template. If a report is valid we will say so
publicly in the fix.

## In scope

The boundaries below are the ones this project claims to hold. A way past any of them is a
vulnerability, and the first three are the ones with tests behind them:

- **Nothing that comes from the model is executed.** Bisect predicates are a closed set of validated
  structured objects — never `eval`, never `new Function`, never an interpolated expression, never a
  compiled regex. `no-eval.test.ts` greps the source and fails the build if `eval(` or `new Function`
  appears anywhere. Any path that gets model-supplied text evaluated is in scope.
- **Every tool response has a size budget**, enforced by tests rather than by intention. A response
  that can be made to exceed its budget — or a compression path that leaks the full DOM — is in scope.
- **No real user recordings in this repository.** Every committed recording is synthetic, produced by
  [`bugbait/`](bugbait). If you find one that looks like a real session, that is a valid report and an
  urgent one.
- **The recorder records shapes, not contents.** `maskAllInputs: true` is mandatory: the recorder
  stores that a field was typed into and how many characters, never the value. The XHR/fetch recorder
  stores method, URL, status and timing, never request or response bodies. A path that captures a
  value or a body is in scope.
- **Selector and timestamp validation.** A selector or timestamp from a model that reaches an unguarded
  API, or escapes the recording's time range, is in scope.
- **Origin-trial token handling.** The token belongs in `.env.local` and must never be committed. A
  token in git history is a valid report.

## Out of scope

Not because they don't matter, but because they are known and stated rather than hidden:

- **A malicious recording file you load yourself.** Traces replays recordings you give it. Loading a
  hostile file is equivalent to opening a hostile document — see the threat model for where the line
  is drawn.
- **The WebMCP spec itself,** including the absence of an `"image"` content type. Report those
  upstream at [webmachinelearning/webmcp](https://github.com/webmachinelearning/webmcp).
- **Anything requiring a compromised browser, extension, or agent client.** If the agent host is
  already hostile, it does not need our tools.
- **`bugbait/` being insecure on purpose.** It is a deliberately broken checkout app whose whole job is
  to produce bugs to record. Its API routes return wrong data by design. Do not report those as
  vulnerabilities; do report anything in `bugbait/` that could harm someone running it locally.
- **Denial of service against your own tab.** A bisect over a huge range is slow. That is a budget
  question, not a security one.

## Nothing to log into

There is no backend, no database, no API key, and no account. Recordings are static JSON, and every
computation — replay, binary search, DOM compression, report validation — happens in the tab. Nothing
is uploaded. That removes an entire class of report, and it is the main reason the attack surface here
is small.
