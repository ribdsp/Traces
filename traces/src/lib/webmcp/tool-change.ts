/**
 * Subscribe to the host's `toolchange` event, on a host that may have no events at all.
 *
 * The spec declares `ModelContext : EventTarget` (`index.bs:604`), so `addEventListener` looks
 * guaranteed and `types/webmcp.d.ts` types it that way. ChatGPT Desktop's in-app browser ships a
 * `document.modelContext` that is **not** an `EventTarget`, and calling one of those methods there
 * throws `TypeError: e.addEventListener is not a function`. Thrown from a client effect, React
 * escalates it to the nearest error boundary, and in a production build that is Next.js's global one:
 * the entire page replaced by "Application error: a client-side exception has occurred" — in the one
 * browser with native WebMCP, which is the browser the challenge rules ask judges to use.
 *
 * So the subscription is optional and its absence is silent in the UI. Both callers render a real list
 * without it; all that is lost is live updates when the surface changes shape mid-session. Losing that
 * is a footnote. Losing the page is the submission.
 *
 * Guarded by `typeof` **and** wrapped, because the lesson of that crash is not "this one method was
 * missing" — it is that a draft API on a host we do not control must never be able to take the page
 * down. Returns the unsubscribe, which is a no-op when there was nothing to subscribe to.
 */
export function onToolChange(context: ModelContext, listener: () => void): () => void {
  const noop = () => {}

  if (typeof context.addEventListener !== 'function') {
    warnOnce('this host exposes no toolchange events; the tool list will not live-update')
    return noop
  }

  try {
    context.addEventListener('toolchange', listener)
  } catch (error: unknown) {
    warnOnce(`toolchange subscription failed: ${message(error)}`)
    return noop
  }

  return () => {
    if (typeof context.removeEventListener !== 'function') return
    try {
      context.removeEventListener('toolchange', listener)
    } catch {
      // A host that cannot remove a listener it accepted is not worth a second diagnostic. The
      // component is unmounting either way, and its own `active` flag already makes the callback inert.
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * One line per page load, not one per subscriber.
 *
 * Two components subscribe, and both remount under React 19's double invoke in development, so an
 * unguarded warning prints four times and reads like four separate faults.
 */
const warned = new Set<string>()

function warnOnce(text: string): void {
  if (warned.has(text)) return
  warned.add(text)
  // eslint-disable-next-line no-console -- a surface that silently stops updating is invisible otherwise
  console.warn(`[traces] ${text}`)
}

/** Test seam: the warning set is module state, and a suite asserting on it needs it empty. */
export function resetToolChangeWarnings(): void {
  warned.clear()
}
