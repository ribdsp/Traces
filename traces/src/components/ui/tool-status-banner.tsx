'use client'

import { TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { onToolChange } from '@/lib/webmcp/tool-change'
import type { RegistrationResult } from '@/lib/webmcp/register-tools'

interface ToolStatusBannerProps {
  registration: RegistrationResult | null
}

/**
 * Says out loud whether the tool surface is actually live.
 *
 * Without this, the failure mode is brutal: the origin trial token is missing or expired, no tool ever
 * registers, and the page looks completely fine. Someone loses an evening to that — probably during
 * judging, on a browser that isn't ours.
 *
 * So the four states are stated plainly:
 *
 *   native     — `document.modelContext` exists *and* tools registered. The real thing. Say which
 *                browser and that it's live.
 *   rejected   — `document.modelContext` exists and `registered` is empty. See below; this is the one
 *                state that used to lie.
 *   polyfill   — our shim. Tools are callable from the console via `window.tracesTools`, but no agent
 *                can see them. Say that, because a demo recorded against the polyfill isn't a demo.
 *   unavailable — nothing registered. Name the likely cause (missing or expired Origin-Trial header)
 *                and link the setup steps in the README. A vague "not supported" sends people to the
 *                wrong problem.
 *
 * `rejected` exists because `native` alone was not a health check, and this component's whole job is
 * being trusted about that. `registerTools` catches each host rejection per tool, warns, and returns
 * `{ mode: 'native', registered: [] }` — so a document that reaches the host without being
 * origin-isolated produces a green banner over a page where nothing is agent-callable. The comment on
 * `headers()` in next.config.mjs calls that "the worst available failure" and it is: every other broken
 * state announces itself. Branch on the count, not just the mode.
 *
 * A note on colour, because two vocabularies meet near here: everything below is `ok`, `warn` or
 * `error` — severity. `agent` and `human` are a separate family, reserved for who authored a
 * contribution, and this banner never renders one. Keeping them apart is what stops a `warn`
 * "polyfill" line from reading as something the agent said.
 *
 * Severity is never carried by colour alone. Each degraded state leads with a word — "unavailable",
 * "Every tool was rejected", "Polyfill" — and the glyph beside it is `TriangleAlert` in all three, so a
 * monochrome screen loses nothing that was load-bearing.
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
   * on `document.modelContext`, which is why the draft has it extend `EventTarget`. Not every host
   * honours that, and one of them is ChatGPT Desktop; `onToolChange` explains what subscribing there
   * used to cost. When the host has no events this counter simply never moves.
   *
   * What is shown is the number of changes, not a recomputed total, and that is on purpose. `getTools()`
   * is declared and could be awaited here, but this banner's verdict has one source — the `registration`
   * prop — and a total read from a second source is a total that can disagree with the mode printed
   * beside it, in the one component whose entire job is being trusted about this. `webmcp-badge.tsx` does
   * read `getTools()`, because it lists the surface rather than judging it. If registration ever hands
   * down a fresh `RegistrationResult` after a dynamic registration, this becomes an exact count and the
   * counter goes away.
   */
  useEffect(() => {
    const context = document.modelContext
    if (!context) return

    setChanges(0)
    const bump = () => setChanges((n) => n + 1)

    return onToolChange(context, bump)
  }, [registration])

  if (!registration) return null

  const count = registration.registered.length
  const countLabel = `${count} ${count === 1 ? 'tool' : 'tools'}`
  const changeLabel = changes > 0 ? `+${changes} since load` : null

  if (registration.mode === 'unavailable') {
    return (
      <div
        role="alert"
        className="flex shrink-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-error/50 bg-error/10 px-3 py-1.5 text-[11px] text-ink"
      >
        <TriangleAlert aria-hidden size={12} strokeWidth={1.5} className="shrink-0 self-center text-error" />
        <span className="font-medium uppercase tracking-wide text-error">WebMCP unavailable</span>
        <span className="font-mono text-error/80">0 tools registered</span>
        <span>
          Nothing on this page is agent-callable. Likely cause: the <code>Origin-Trial</code> header is
          missing or expired.
        </span>
        <span className="text-muted">
          Set <code>NEXT_PUBLIC_WEBMCP_ORIGIN_TRIAL_TOKEN</code> in <code>.env.local</code> and restart —
          README, “Getting WebMCP in your browser”. Needs Chrome 149+ or Edge 150+ and a{' '}
          <a
            href="https://developer.chrome.com/origintrials"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted underline-offset-2 hover:text-ink hover:decoration-solid focus-visible:bg-raised focus-visible:text-ink focus-visible:outline-none"
          >
            token for this origin
          </a>
          .
        </span>
      </div>
    )
  }

  /**
   * The host is present and rejected everything. `error`, `role="alert"`, and it names both cheap causes:
   * the isolation header, and the cached response that still lacks it — a hard reload is the fix people
   * do not think to try, because the page it produces looks identical.
   */
  if (registration.mode === 'native' && count === 0) {
    return (
      <div
        role="alert"
        className="flex shrink-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-error/50 bg-error/10 px-3 py-1.5 text-[11px] text-ink"
      >
        <TriangleAlert aria-hidden size={12} strokeWidth={1.5} className="shrink-0 self-center text-error" />
        <span className="font-medium uppercase tracking-wide text-error">Every tool was rejected</span>
        <span className="font-mono text-error/80">0 tools registered</span>
        <span>
          <code>document.modelContext</code> exists{browser && ` in ${browser}`}, so this looks healthy
          and is not: every <code>registerTool</code> call threw and nothing here is agent-callable.
        </span>
        <span className="text-muted">
          WebMCP refuses to register unless the document is origin-isolated. Check that the response
          carries <code>Origin-Agent-Cluster: ?1</code> — and hard-reload, because a response cached from
          before that header was added produces exactly this. The console has one{' '}
          <code>host rejected tool</code> warning per tool with the reason.
        </span>
      </div>
    )
  }

  if (registration.mode === 'polyfill') {
    return (
      <div
        role="status"
        className="flex shrink-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-warn/40 bg-warn/10 px-3 py-1 text-[11px] text-ink"
      >
        <TriangleAlert aria-hidden size={12} strokeWidth={1.5} className="shrink-0 self-center text-warn" />
        <span className="font-medium uppercase tracking-wide text-warn">Polyfill</span>
        <span className="font-mono text-warn/80">
          {countLabel}
          {changeLabel ? ` · ${changeLabel}` : ''}
        </span>
        <span>
          Callable by hand as <code>window.tracesTools</code>. No agent can see them, so a run recorded
          against the polyfill is a rehearsal, not a demo.
        </span>
      </div>
    )
  }

  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1 text-[11px] text-muted"
    >
      <span aria-hidden className="h-1.5 w-1.5 bg-ok" />
      <span className="text-ink">WebMCP live</span>
      <span aria-hidden className="text-faint">
        ·
      </span>
      <span className="font-mono">{countLabel}</span>
      {changeLabel ? (
        <span
          className="font-mono text-ok/80"
          title="toolchange events observed since this page loaded"
        >
          {changeLabel}
        </span>
      ) : null}
      <span aria-hidden className="text-faint">
        ·
      </span>
      <span>
        <code>document.modelContext</code>
        {browser && ` in ${browser}`}
      </span>
    </div>
  )
}
