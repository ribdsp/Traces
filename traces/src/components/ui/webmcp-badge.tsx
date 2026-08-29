'use client'

import { ChevronDown, ChevronUp, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { TIMELINE_HEIGHT_PX } from '@/components/timeline/axis'
import { allTools } from '@/lib/webmcp/register-tools'
import { onToolChange } from '@/lib/webmcp/tool-change'
import type { RegistrationResult } from '@/lib/webmcp/register-tools'

/**
 * The corner badge that explains what WebMCP is and what this page exposes.
 *
 * Deliberately the shape judges have already seen: a small docked chip — status dot, the word WebMCP, a
 * chevron — that opens onto a definition, a status block, the tool list, and a few prompts to paste. The
 * pattern is borrowed on purpose. Someone evaluating a WebMCP entry recognises it in under a second, and
 * a second spent recognising the affordance is a second not spent reading our prose.
 *
 * It is not the health indicator. `ToolStatusBanner` is, it is always in flow at the top of the page, and
 * it cannot be collapsed. This panel is the *explanation* — which is why the two duplicate a little text
 * and why only one of them carries a live region: the banner announces, this describes.
 *
 * Three things here are load-bearing rather than stylistic:
 *
 *   - **Degraded states render no collapse control at all.** Not "collapsed by default", not "reopens on
 *     change" — while the surface is amber or red the panel is open and there is no button to close it.
 *     A chip that can hide `polyfill` or `unavailable` behind a neutral-looking dot is the exact bug the
 *     banner exists to prevent, and adding a second, dismissible place for that state to live would
 *     reintroduce it one component over. Green and idle collapse freely.
 *   - **The tool list comes from the host, not from us.** `document.modelContext.getTools()` reports what
 *     the browser actually holds, so a tool the host rejected cannot appear here. Reading our own
 *     `allTools` array instead would render sixteen confident cards on a page where zero are callable.
 *   - **The chevron is two icons, not one rotated one.** Under `prefers-reduced-motion` `globals.css`
 *     collapses transitions to nothing, so a transform-based caret would sit at one angle in both states
 *     and leave open-vs-closed signalled by nothing. Swapping the glyph is state, not animation, and
 *     survives. Every other reduced-motion fallback in the app cites this file, so: the rule is that the
 *     signal has to exist in the static frame.
 *
 * Docked to the right edge above the timeline rather than floating in the corner, because the last few
 * percent of that axis is the end of the recording — markers a judge is meant to click. Covering them to
 * advertise the tool surface would be the panel damaging the thing it describes. The offset is
 * `TIMELINE_HEIGHT_PX` itself rather than a matching Tailwind step: it was `bottom-24` against a 96px
 * timeline, the timeline became 112px, and a literal that has to be remembered is a literal that goes
 * stale silently — the badge simply started overlapping the ruler it was written to clear.
 */

const DEFINITION =
  'WebMCP exposes structured website tools that compatible AI agents can discover and use.'

/**
 * The part people get wrong about WebMCP, so it is stated in the status block in every state: this is not
 * a service. There is no endpoint, no key, and nothing left running when the tab closes.
 *
 * Kept to two lines. Every line spent here is a line of the tool grid pushed below the fold of a panel
 * that is capped in height, and the grid is the part that answers "what can it actually do".
 */
const REACH =
  'Reachable only while this page is open and you have granted access. Nothing here runs on a server.'

/**
 * Prompts that are pasteable as-is, in the order an investigation actually goes: orient, narrow, check,
 * write up. Each one lands on a different group in `allTools`, so a judge working down the list exercises
 * the read tools, the search tools and a blocking collaborate tool without being told which is which.
 */
const EXAMPLES = [
  'What broke in this recording, and when?',
  'Find the last moment the submit button was still enabled.',
  'Read the console around the failure and tell me what threw.',
  'Draft a bug report for what you found, with timestamps I can check.',
] as const

type Health = 'idle' | 'live' | 'warn' | 'error'

/**
 * The same four-way branch `ToolStatusBanner` makes, in the same order, deliberately duplicated.
 *
 * Extracting a shared helper would put the banner's branch structure behind an abstraction, and the banner
 * is the one component in this app whose whole job is being trusted about the surface's health. Five lines
 * repeated is cheaper than a refactor there. If the banner's ordering ever changes, this changes with it —
 * `native` with nothing registered is a red state, not a green one with an unlucky count.
 */
function healthOf(registration: RegistrationResult | null): Health {
  if (registration === null) return 'idle'
  if (registration.mode === 'unavailable') return 'error'
  if (registration.mode === 'native' && registration.registered.length === 0) return 'error'
  if (registration.mode === 'polyfill') return 'warn'
  return 'live'
}

const DOT: Record<Health, string> = {
  idle: 'bg-faint',
  live: 'bg-ok',
  warn: 'bg-warn',
  error: 'bg-error',
}

/** What the dot means, in words, for a screen reader and for anyone who cannot tell the dots apart. */
const STATE_WORD: Record<Health, string> = {
  idle: 'still registering',
  live: 'live',
  warn: 'degraded',
  error: 'unavailable',
}

type ToolCard = { name: string; summary: string; full: string }

/**
 * Tool descriptions are written for models: several sentences, often with an argument note. The card gets
 * the first sentence and the `title` keeps the whole thing, because a 200px column cannot show the rest
 * and truncating mid-clause reads as a rendering fault.
 */
function firstSentence(text: string): string {
  const end = text.search(/\.(\s|$)/)
  return end === -1 ? text : text.slice(0, end + 1)
}

function cardsOf(tools: readonly { name: string; description: string }[]): ToolCard[] {
  return tools.map((tool) => ({
    name: tool.name,
    summary: firstSentence(tool.description),
    full: tool.description,
  }))
}

export function WebMcpBadge({ registration }: { registration: RegistrationResult | null }) {
  const [open, setOpen] = useState(false)
  const [hosted, setHosted] = useState<ToolCard[] | null>(null)

  /**
   * Ask the host what it is holding, and ask again whenever the surface changes shape.
   *
   * Keyed on `registration` because that is what tells us `document.modelContext` exists yet — before it
   * lands there is either no shim installed or no origin trial, and either way nothing to read.
   */
  useEffect(() => {
    const context = document.modelContext
    if (!context) return

    // Declared as required in types/webmcp.d.ts, guarded anyway: a host part-way through shipping the
    // origin trial is exactly the case this panel has to survive, and the fallback below is honest.
    if (typeof context.getTools !== 'function') return

    let active = true

    const read = () => {
      context
        .getTools()
        .then((tools) => {
          if (active) setHosted(cardsOf(tools))
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          // eslint-disable-next-line no-console -- a host that refuses to list its tools is invisible otherwise
          console.warn(`[traces] getTools() failed: ${message}`)
        })
    }

    read()
    const unsubscribe = onToolChange(context, read)
    return () => {
      active = false
      unsubscribe()
    }
  }, [registration])

  const health = healthOf(registration)

  /*
   * Amber and red are not collapsible. See the note at the top of the file: this is the constraint that
   * keeps a second, dismissible copy of the surface's health from undoing the banner.
   */
  const degraded = health === 'warn' || health === 'error'
  const expanded = degraded || open

  /*
   * The host's list when we have one, ours when we do not — and ours is filtered to what actually
   * registered, never the full `allTools` array. `registered` carries names only, so the descriptions are
   * looked up locally; the *set* of cards still comes from the registration result either way.
   */
  const fallback = (registration?.registered ?? [])
    .map((name) => allTools.find((tool) => tool.name === name))
    .filter((tool): tool is (typeof allTools)[number] => tool !== undefined)

  const tools = hosted !== null && hosted.length > 0 ? hosted : cardsOf(fallback)

  const header = (
    <>
      {degraded ? (
        <TriangleAlert
          aria-hidden
          size={14}
          strokeWidth={1.75}
          className={`shrink-0 ${health === 'error' ? 'text-error' : 'text-warn'}`}
        />
      ) : (
        <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[health]}`} />
      )}
      <span className="font-mono text-label tracking-wide text-ink">WebMCP</span>
      <span className="sr-only">— {STATE_WORD[health]}</span>
    </>
  )

  /*
   * The chip is flush to the right edge, so only its left corners are visible, and the top-left one is only
   * an outside corner while the panel above it is closed. Rounding it unconditionally would notch the seam
   * between the two.
   */
  const chipRadius = expanded ? 'rounded-bl-md' : 'rounded-bl-md rounded-tl-md'

  return (
    <div
      /* See the docstring: tracks the timeline's own height rather than restating it as a class. */
      style={{ bottom: TIMELINE_HEIGHT_PX }}
      className="fixed right-0 z-20 flex flex-col items-stretch"
    >
      {expanded ? (
        /*
          The height cap is a functional limit, not a taste one. This panel is forced open in every degraded
          state, and a taller one reaches up past the agent lane's input — a control `page.tsx` focuses by
          keyboard shortcut, which must never be covered by something with no close button. 18rem plus the
          112px the timeline takes puts its top edge 400px off the bottom, which clears the input at the
          720px recording height, and the overflow scrolls.
        */
        <div
          id="webmcp-panel"
          className="max-h-72 w-80 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-tl-md border-l border-t border-line-strong bg-panel p-3 shadow-raised"
        >
          <p className="text-meta leading-relaxed text-ink">{DEFINITION}</p>

          <div className="mt-2.5 border-t border-line pt-2.5">
            <h3 className="text-micro uppercase tracking-wide text-faint">Status</h3>
            <p className="mt-1 text-meta leading-relaxed text-ink">
              <StatusSentence health={health} count={tools.length} />
            </p>
            <p className="mt-1 text-label leading-relaxed text-muted">{REACH}</p>
          </div>

          {tools.length > 0 ? (
            <div className="mt-2.5 border-t border-line pt-2.5">
              <h3 className="text-micro uppercase tracking-wide text-faint">
                Tools on this page ({tools.length})
              </h3>
              <ul className="mt-1.5 grid grid-cols-2 gap-1.5">
                {tools.map((tool) => (
                  <li
                    key={tool.name}
                    className="rounded-sm border border-line bg-raised p-1.5"
                    title={tool.full}
                  >
                    <p className="font-mono text-label leading-none text-ink">{tool.name}</p>
                    {/*
                      Two lines, hard. `firstSentence` is already the short form and it is still six lines
                      wide for `read_session_meta` in a 145px column, which turns sixteen cards into a wall
                      of prose nobody reads. The clamp is what makes this a scannable index; `title` on the
                      card keeps the sentence available to anyone who wants it.
                    */}
                    <p className="mt-1 line-clamp-2 text-label leading-tight text-muted">
                      {tool.summary}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-2.5 border-t border-line pt-2.5">
            <h3 className="text-micro uppercase tracking-wide text-faint">Try asking</h3>
            {/*
              Quoted and left as prose rather than made copyable. A copy button here would need its own
              clipboard-failure path — `report-draft.tsx` has one because a report is the artefact worth
              that code, and a four-word prompt someone can retype is not.
            */}
            <ul className="mt-1 space-y-1">
              {EXAMPLES.map((example) => (
                <li key={example} className="text-label leading-relaxed text-muted">
                  “{example}”
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {degraded ? (
        /*
          No button, on purpose. The chip still names the surface so the badge does not vanish in the state
          it matters most, but there is nothing here to click, so there is nothing here that can hide it.
        */
        <div
          className={`flex items-center gap-1.5 border-l border-t border-line-strong bg-panel px-2 py-1 ${chipRadius}`}
        >
          {header}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((wasOpen) => !wasOpen)}
          aria-expanded={expanded}
          aria-controls="webmcp-panel"
          title={
            expanded
              ? 'Hide the WebMCP tool surface.'
              : 'What WebMCP is, which tools this page exposes, and what to ask an agent.'
          }
          className={`flex items-center gap-1.5 border-l border-t border-line-strong bg-panel px-2 py-1 text-left hover:bg-raised focus-visible:bg-raised ${chipRadius}`}
        >
          {header}
          {expanded ? (
            <ChevronDown aria-hidden size={13} strokeWidth={1.75} className="ml-auto text-muted" />
          ) : (
            <ChevronUp aria-hidden size={13} strokeWidth={1.75} className="ml-auto text-muted" />
          )}
        </button>
      )}
    </div>
  )
}

/**
 * Whether tools are available, in one sentence, per state.
 *
 * `polyfill` says the quiet part out loud: the count is real and the tools work from this page, but no
 * external agent can see any of them. A judge reading "16 tools" beside an amber dot deserves to know
 * which of those two facts they are looking at.
 */
function StatusSentence({ health, count }: { health: Health; count: number }) {
  if (health === 'idle') return <>Registering the tool surface…</>

  if (health === 'error' && count === 0) {
    return (
      <>
        No tools are available — either this browser has no WebMCP surface, or it has one and refused every
        tool. The banner at the top of the page says which.
      </>
    )
  }

  if (health === 'warn') {
    return (
      <>
        {count} tools registered against the local development shim, not the browser’s own WebMCP. Callable
        from this page; no external agent can see them.
      </>
    )
  }

  return <>{count} tools registered with the browser and callable by a connected agent.</>
}
