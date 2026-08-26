'use client'

import { useEffect, useState } from 'react'
import type { RegistrationResult } from '@/lib/webmcp/register-tools'

interface ToolStatusBannerProps {
  registration: RegistrationResult | null
}

/**
 * Says out loud whether the tool surface is actually live.
 *
 * Owner: Faiq.
 *
 * Without this, the failure mode is brutal: the origin trial token is missing or expired, no tool ever
 * registers, and the page looks completely fine. Someone loses an evening to that — probably during
 * judging, on a browser that isn't ours.
 *
 * So the three states are stated plainly:
 *
 *   native     — `document.modelContext` exists. The real thing. Say which browser and that it's live.
 *   polyfill   — our shim. Tools are callable from the console via `window.tracesTools`, but no agent
 *                can see them. Say that, because a demo recorded against the polyfill isn't a demo.
 *   unavailable — nothing registered. Name the likely cause (missing or expired Origin-Trial header)
 *                and link the setup steps in the README. A vague "not supported" sends people to the
 *                wrong problem.
 *
 * A note on colour, since it looks like a contradiction: emerald/amber/rose here are *status*, not
 * authorship. The amber-agent / sky-human pairing in AuthorBadge applies to contributions, and this
 * banner never renders one. Keeping the two vocabularies apart is deliberate — an amber "polyfill"
 * warning does not mean the agent wrote it.
 */

/**
 * Rough browser name for the `native` line, so "it's live" is attributable to something.
 *
 * Deliberately crude. This is a caption on a status bar, not analytics, and the alternative —
 * `navigator.userAgentData.brands`, itself behind availability caveats — buys nothing for a string a
 * human reads once. Order matters: Edge's UA string contains "Chrome", so it is tested first.
 */
function browserLabel(userAgent: string): string {
  if (/\bEdg\//.test(userAgent)) return 'Edge'
  if (/\bChrome\//.test(userAgent)) return 'Chrome'
  if (/\bFirefox\//.test(userAgent)) return 'Firefox'
  if (/\bSafari\//.test(userAgent)) return 'Safari'
  return 'this browser'
}

export function ToolStatusBanner({ registration }: ToolStatusBannerProps) {
  const [browser, setBrowser] = useState('')
  const [changes, setChanges] = useState(0)

  /** Prerendered by `next build`, so `navigator` is read after mount or hydration disagrees. */
  useEffect(() => {
    setBrowser(browserLabel(navigator.userAgent))
  }, [])

  /**
   * `toolchange` is how a surface that grew a tool mid-investigation shows up here without a reload —
   * the promoted-hypothesis tool from `registerDynamicTool` is the case worth demoing. The event fires
   * on `document.modelContext`, which is why the draft has it extend `EventTarget`.
   *
   * What is shown is the number of changes, not a recomputed total, and that is on purpose. The declared
   * API in types/webmcp.d.ts has `registerTool` and nothing else — there is no list to re-read — so a
   * new total here would be a guess dressed as a fact, in the one component whose entire job is being
   * trusted about this. If registration ever hands down a fresh `RegistrationResult` after a dynamic
   * registration, this becomes an exact count and the counter goes away.
   */
  useEffect(() => {
    const context = document.modelContext
    if (!context) return

    setChanges(0)
    const onToolChange = () => setChanges((n) => n + 1)

    context.addEventListener('toolchange', onToolChange)
    return () => context.removeEventListener('toolchange', onToolChange)
  }, [registration])

  if (!registration) return null

  const count = registration.registered.length
  const countLabel = `${count} ${count === 1 ? 'tool' : 'tools'}`
  const changeLabel = changes > 0 ? `+${changes} since load` : null

  if (registration.mode === 'unavailable') {
    return (
      <div
        role="alert"
        className="flex shrink-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-rose-500/50 bg-rose-500/15 px-3 py-1.5 text-[11px] text-rose-100"
      >
        <span className="font-medium uppercase tracking-wide">WebMCP unavailable</span>
        <span className="font-mono text-rose-200/80">0 tools registered</span>
        <span className="text-rose-200/90">
          Nothing on this page is agent-callable. Likely cause: the <code>Origin-Trial</code> header is
          missing or expired.
        </span>
        <span className="text-rose-200/70">
          Set <code>NEXT_PUBLIC_WEBMCP_ORIGIN_TRIAL_TOKEN</code> in <code>.env.local</code> and restart —
          README, “Getting WebMCP in your browser”. Needs Chrome 149+ or Edge 150+ and a{' '}
          <a
            href="https://developer.chrome.com/origintrials"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-rose-300/50 underline-offset-2 hover:decoration-rose-100"
          >
            token for this origin
          </a>
          .
        </span>
      </div>
    )
  }

  if (registration.mode === 'polyfill') {
    return (
      <div
        role="status"
        className="flex shrink-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-amber-500/40 bg-amber-500/10 px-3 py-1 text-[11px] text-amber-100"
      >
        <span className="font-medium uppercase tracking-wide">Polyfill</span>
        <span className="font-mono text-amber-200/80">
          {countLabel}
          {changeLabel ? ` · ${changeLabel}` : ''}
        </span>
        <span className="text-amber-200/90">
          Callable by hand as <code>window.tracesTools</code>. No agent can see them, so a run recorded
          against the polyfill is a rehearsal, not a demo.
        </span>
      </div>
    )
  }

  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-1 text-[11px] text-zinc-400"
    >
      <span aria-hidden className="h-1.5 w-1.5 bg-emerald-400" />
      <span className="text-zinc-300">WebMCP live</span>
      <span className="text-zinc-700">·</span>
      <span className="font-mono text-zinc-400">{countLabel}</span>
      {changeLabel ? (
        <span
          className="font-mono text-emerald-300/80"
          title="toolchange events observed since this page loaded"
        >
          {changeLabel}
        </span>
      ) : null}
      <span className="text-zinc-700">·</span>
      <span className="text-zinc-500">
        <code>document.modelContext</code>
        {browser && ` in ${browser}`}
      </span>
    </div>
  )
}
