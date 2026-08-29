'use client'

import { TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
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
 *   native     — `document.modelContext` exists *and* tools registered. The real thing. This is the one
 *                state that does *not* get a full-width row: see the note on the pill below.
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
 * **The healthy state is a pill in the header, and the three degraded states are still full-width rows
 * in flow.** That asymmetry is the whole design, and it is not a space saving. A green row across the
 * top of a 720px window spent a line of permanent vertical budget restating something true 99% of the
 * time, and it trained the eye to skip the exact strip of pixels that has to be read the other 1%. So
 * healthy compresses to five words beside the wordmark; amber and red keep the row, keep their live
 * region, keep their remediation prose, and cannot be collapsed or dismissed — there is no control here
 * that hides them, by construction rather than by default. The pill turns amber and red too, but it is
 * never the *only* thing that does.
 *
 * The pill reaches the header through a portal into a slot `page.tsx` renders. It has to: registration
 * is owned by `ToolSurface` in the root layout, which is a sibling of the page rather than a parent, and
 * the alternative — a second component in the header deriving health from `document.modelContext`
 * itself — would give this app two sources of truth about whether it works, in the one place where that
 * cannot be allowed to disagree. One `registration` prop, one `healthOf`, two renderings.
 *
 * A note on colour, because two vocabularies meet near here: everything below is `ok`, `warn` or
 * `error` — severity. `agent` and `human` are a separate family, reserved for who authored a
 * contribution, and this banner never renders one. Keeping them apart is what stops a `warn`
 * "polyfill" line from reading as something the agent said.
 *
 * Severity is never carried by colour alone. Each degraded state leads with a word — "unavailable",
 * "Every tool was rejected", "Polyfill" — and the glyph beside it is `TriangleAlert` in all three, so a
 * monochrome screen loses nothing that was load-bearing. The pill carries the same word for a screen
 * reader and in its tooltip.
 */

/** The header slot the pill portals into. `page.tsx` renders the element; this file owns the name. */
export const TOOL_STATUS_SLOT_ID = 'traces-tool-status'

type Health = 'idle' | 'live' | 'warn' | 'error'

/**
 * The four-way branch, once. `webmcp-badge.tsx` deliberately duplicates it rather than importing —
 * see the note there — but the banner and its own pill must never diverge, so they share this.
 */
function healthOf(registration: RegistrationResult | null): Health {
  if (registration === null) return 'idle'
  if (registration.mode === 'unavailable') return 'error'
  if (registration.mode === 'native' && registration.registered.length === 0) return 'error'
  if (registration.mode === 'polyfill') return 'warn'
  return 'live'
}

/** What the dot means, in words, for a screen reader and for anyone who cannot tell the dots apart. */
const STATE_WORD: Record<Health, string> = {
  idle: 'registering',
  live: 'live',
  warn: 'polyfill only',
  error: 'unavailable',
}

const PILL: Record<Health, string> = {
  idle: 'border-line bg-panel text-muted',
  live: 'border-line bg-panel text-ink',
  warn: 'border-warn/40 bg-warn/10 text-warn',
  error: 'border-error/50 bg-error/10 text-error',
}

const DOT: Record<Health, string> = {
  idle: 'bg-faint',
  live: 'bg-ok',
  warn: 'bg-warn',
  error: 'bg-error',
}

/**
 * Rough browser name, so "it's live" is attributable to something.
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
  const [slot, setSlot] = useState<HTMLElement | null>(null)

  /** Prerendered by `next build`, so `navigator` is read after mount or hydration disagrees. */
  useEffect(() => {
    setBrowser(browserLabel(navigator.userAgent))
  }, [])

  /**
   * The header slot, found once after the first commit. Effects run after the whole tree is in the DOM,
   * so the element `page.tsx` renders exists by now even though this component is mounted above it.
   */
  useEffect(() => {
    setSlot(document.getElementById(TOOL_STATUS_SLOT_ID))
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

  const health = healthOf(registration)
  const count = registration?.registered.length ?? 0
  const countLabel = `${count} ${count === 1 ? 'tool' : 'tools'}`
  const changeLabel = changes > 0 ? `+${changes} since load` : null

  const pill =
    slot === null
      ? null
      : createPortal(
          <StatusPill
            health={health}
            count={count}
            changes={changes}
            browser={browser}
            ready={registration !== null}
          />,
          slot,
        )

  /*
   * The pill renders in every state including the degraded ones, and the row below renders alongside it
   * rather than instead of it. Two signals for one fact is the point: the header is where the eye
   * already is, and the row is what cannot be missed.
   */
  return (
    <>
      {pill}
      {registration === null ? null : (
        <DegradedRow
          registration={registration}
          health={health}
          browser={browser}
          countLabel={countLabel}
          changeLabel={changeLabel}
        />
      )}
    </>
  )
}

interface StatusPillProps {
  health: Health
  count: number
  /** `toolchange` events seen since load, shown as `+n` beside the count when the host emits any. */
  changes: number
  browser: string
  ready: boolean
}

/**
 * Five words in the header: a state dot, the surface's name, and how many tools are on it.
 *
 * `role="status"` rather than nothing, because this inherited the healthy row's live region along with
 * its job — a surface that registers late, or grows a tool mid-session, should still be announced.
 * `aria-live` politeness is the default for `status`, which is right for a count that changes on its own.
 */
function StatusPill({ health, count, changes, browser, ready }: StatusPillProps) {
  const where = browser ? ` in ${browser}` : ''
  const title = !ready
    ? 'Registering the WebMCP tool surface…'
    : health === 'live'
      ? `WebMCP live — ${count} tools registered with document.modelContext${where} and callable by a connected agent.`
      : health === 'warn'
        ? `${count} tools registered against the local development shim, not the browser's own WebMCP. No external agent can see them.`
        : 'No tools are agent-callable. The banner below the header says why.'

  return (
    <div
      role="status"
      title={title}
      className={`flex shrink-0 items-center gap-1.5 rounded-sm border px-1.5 py-0.5 ${PILL[health]}`}
    >
      {health === 'warn' || health === 'error' ? (
        <TriangleAlert aria-hidden size={12} strokeWidth={1.75} className="shrink-0" />
      ) : (
        <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[health]}`} />
      )}
      <span className="text-label tracking-wide">WebMCP</span>
      <span aria-hidden className="h-2.5 w-px bg-current opacity-25" />
      <span className="font-mono text-label tabular-nums">
        {ready ? count : '–'}
        {changes > 0 ? (
          <span className="opacity-70" title={`${changes} toolchange events since load`}>
            {' '}
            +{changes}
          </span>
        ) : null}
      </span>
      {/* The dot is decoration to a screen reader; this is the state it stands for. */}
      <span className="sr-only">— {STATE_WORD[health]}</span>
    </div>
  )
}

interface DegradedRowProps {
  registration: RegistrationResult
  health: Health
  browser: string
  countLabel: string
  changeLabel: string | null
}

/**
 * The full-width row, for the three states that have something to explain.
 *
 * Shared shell, per-state contents. The shell is what carries the guarantees — in flow, `shrink-0`, a
 * live region, a leading glyph, and no close button anywhere in it.
 */
function DegradedRow({
  registration,
  health,
  browser,
  countLabel,
  changeLabel,
}: DegradedRowProps) {
  if (health === 'live' || health === 'idle') return null

  if (registration.mode === 'unavailable') {
    return (
      <Row tone="error">
        <Tag tone="error">WebMCP unavailable</Tag>
        <span className="font-mono text-meta tabular-nums text-error/80">0 tools registered</span>
        <span>
          Nothing on this page is agent-callable. Likely cause: the <Code>Origin-Trial</Code> header is
          missing or expired.
        </span>
        <span className="text-muted">
          Set <Code>NEXT_PUBLIC_WEBMCP_ORIGIN_TRIAL_TOKEN</Code> in <Code>.env.local</Code> and restart —
          README, “Getting WebMCP in your browser”. Needs Chrome 149+ or Edge 150+ and a{' '}
          <a
            href="https://developer.chrome.com/origintrials"
            target="_blank"
            rel="noreferrer"
            className="rounded-sm underline decoration-dotted underline-offset-2 hover:text-ink hover:decoration-solid"
          >
            token for this origin
          </a>
          .
        </span>
      </Row>
    )
  }

  /**
   * The host is present and rejected everything. `error`, `role="alert"`, and it names both cheap causes:
   * the isolation header, and the cached response that still lacks it — a hard reload is the fix people
   * do not think to try, because the page it produces looks identical.
   */
  if (registration.mode === 'native') {
    return (
      <Row tone="error">
        <Tag tone="error">Every tool was rejected</Tag>
        <span className="font-mono text-meta tabular-nums text-error/80">0 tools registered</span>
        <span>
          <Code>document.modelContext</Code> exists{browser && ` in ${browser}`}, so this looks healthy
          and is not: every <Code>registerTool</Code> call threw and nothing here is agent-callable.
        </span>
        <span className="text-muted">
          WebMCP refuses to register unless the document is origin-isolated. Check that the response
          carries <Code>Origin-Agent-Cluster: ?1</Code> — and hard-reload, because a response cached from
          before that header was added produces exactly this. The console has one{' '}
          <Code>host rejected tool</Code> warning per tool with the reason.
        </span>
      </Row>
    )
  }

  return (
    <Row tone="warn">
      <Tag tone="warn">Polyfill</Tag>
      <span className="font-mono text-meta tabular-nums text-warn/80">
        {countLabel}
        {changeLabel ? ` · ${changeLabel}` : ''}
      </span>
      <span>
        Callable by hand as <Code>window.tracesTools</Code>. No agent can see them, so a run recorded
        against the polyfill is a rehearsal, not a demo.
      </span>
    </Row>
  )
}

/**
 * `role` is chosen by tone, and both are live regions: `alert` interrupts, `status` waits its turn. A
 * surface that is entirely dead is worth interrupting for; one running on the shim is not.
 */
function Row({ tone, children }: { tone: 'warn' | 'error'; children: React.ReactNode }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex shrink-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b px-3 py-1.5 text-body text-ink ${
        tone === 'error' ? 'border-error/50 bg-error/10' : 'border-warn/40 bg-warn/10'
      }`}
    >
      <TriangleAlert
        aria-hidden
        size={14}
        strokeWidth={1.75}
        className={`shrink-0 self-center ${tone === 'error' ? 'text-error' : 'text-warn'}`}
      />
      {children}
    </div>
  )
}

/** The state, as a word, in a chip — so the row reads as a labelled state and not as a sentence. */
function Tag({ tone, children }: { tone: 'warn' | 'error'; children: React.ReactNode }) {
  return (
    <span
      className={`rounded-sm border px-1 py-px text-label font-medium uppercase tracking-wide ${
        tone === 'error' ? 'border-error/50 text-error' : 'border-warn/50 text-warn'
      }`}
    >
      {children}
    </span>
  )
}

/** Header names and env vars, in mono, at a size that survives being video. */
function Code({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-meta text-ink/90">{children}</code>
}
