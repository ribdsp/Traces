'use client'

import { Wrench } from 'lucide-react'
import { useEffect, useState } from 'react'
import { allTools } from '@/lib/webmcp/register-tools'
import { onToolChange } from '@/lib/webmcp/tool-change'
import type { RegistrationResult } from '@/lib/webmcp/register-tools'

/**
 * The explanation that opens from the header's WebMCP pill.
 *
 * It used to be a second chip, docked above the timeline. Two chips stating the same count taught the
 * eye that WebMCP was a decoration; one pill in the header that *opens* is both the health signal and
 * the catalogue. `ToolStatusBanner` still owns the live region and the degraded row — this file only
 * describes the surface, it never announces it.
 *
 * Two things here are load-bearing rather than stylistic:
 *
 *   - **The tool list comes from the host, not from us.** `document.modelContext.getTools()` reports what
 *     the browser actually holds, so a tool the host rejected cannot appear here. Reading our own
 *     `allTools` array instead would render sixteen confident cards on a page where zero are callable.
 *   - **The panel is a dropdown, not a dock.** Opening it from the header means it can be dismissed, so
 *     the old rule that a red panel had no close button does not apply: the thing that must not be
 *     hideable is the banner row, and that row is still in flow with no close control.
 */

const REACH = 'Reachable only while this page is open. Nothing here runs on a server.'

type Health = 'idle' | 'live' | 'warn' | 'error'

/**
 * The same four-way branch `ToolStatusBanner` makes, in the same order, deliberately duplicated.
 *
 * Extracting a shared helper would put the banner's branch structure behind an abstraction, and the banner
 * is the one component in this app whose whole job is being trusted about the surface's health. Five lines
 * repeated is cheaper than a refactor there.
 */
function healthOf(registration: RegistrationResult | null): Health {
  if (registration === null) return 'idle'
  if (registration.mode === 'unavailable') return 'error'
  if (registration.mode === 'native' && registration.registered.length === 0) return 'error'
  if (registration.mode === 'polyfill') return 'warn'
  return 'live'
}

const STATE_WORD: Record<Health, string> = {
  idle: 'still registering',
  live: 'live',
  warn: 'degraded',
  error: 'unavailable',
}

const STATE_CHIP: Record<Health, string> = {
  idle: 'border-line text-muted',
  live: 'border-ok/40 text-ok',
  warn: 'border-warn/40 text-warn',
  error: 'border-error/50 text-error',
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

export function WebMcpPanel({ registration }: { registration: RegistrationResult | null }) {
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
   * The host's list when we have one, ours when we do not — and ours is filtered to what actually
   * registered, never the full `allTools` array. `registered` carries names only, so the descriptions are
   * looked up locally; the *set* of cards still comes from the registration result either way.
   */
  const fallback = (registration?.registered ?? [])
    .map((name) => allTools.find((tool) => tool.name === name))
    .filter((tool): tool is (typeof allTools)[number] => tool !== undefined)

  const tools = hosted !== null && hosted.length > 0 ? hosted : cardsOf(fallback)

  return (
    <div
      id="webmcp-panel"
      className="max-h-[min(28rem,calc(100vh-6rem))] w-96 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-md border border-line-strong bg-panel shadow-raised"
    >
      <div className="sticky top-0 z-10 border-b border-line bg-panel px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-ink">WebMCP</span>
          <span
            className={`rounded-sm border px-1 font-mono text-label uppercase tracking-wide ${STATE_CHIP[health]}`}
          >
            {STATE_WORD[health]}
          </span>
          {tools.length > 0 ? (
            <span className="ml-auto font-mono text-label tabular-nums text-muted">{tools.length}</span>
          ) : null}
        </div>
        <p className="mt-1 text-body leading-relaxed text-ink">
          <StatusSentence health={health} count={tools.length} />
        </p>
        <p className="mt-0.5 text-label leading-relaxed text-faint">{REACH}</p>
      </div>

      {tools.length > 0 ? (
        <div className="px-3 py-2.5">
          <h3 className="mb-1.5 flex items-center gap-1.5 text-micro uppercase tracking-wide text-faint">
            <Wrench aria-hidden size={12} strokeWidth={1.75} className="shrink-0" />
            Tools
          </h3>
          <ul className="grid grid-cols-2 gap-1.5">
            {tools.map((tool) => (
              <li
                key={tool.name}
                className="rounded-sm border border-line bg-raised px-2 py-1.5"
                title={tool.full}
              >
                <p className="truncate font-mono text-label leading-none text-ink">{tool.name}</p>
                {/*
                  Two lines, hard. `firstSentence` is already the short form and it is still six lines
                  wide for `read_session_meta` in a 145px column, which turns sixteen cards into a wall
                  of prose nobody reads. The clamp is what makes this a scannable index; `title` on the
                  card keeps the sentence available to anyone who wants it.
                */}
                <p className="mt-1 line-clamp-2 text-label leading-tight text-muted">{tool.summary}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
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