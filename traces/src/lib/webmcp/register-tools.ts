import { allTools, assertUniqueToolNames } from './tools'
import { installWebMcpPolyfill, polyfillRegistry } from './polyfill'

/**
 * The one place every tool is registered.
 *
 * Everything goes through a single `AbortController`, so unmounting deregisters the entire surface in
 * one line. Scattering `registerTool` calls across components is the version of this that leaves
 * stale tools registered after a hot reload — and the symptom is a model calling a tool whose closure
 * points at a recording that no longer exists, which is a genuinely confusing hour of debugging.
 *
 * Called exactly once, from app/layout.tsx. If you find yourself calling it from a second place,
 * that's the bug.
 */

let controller: AbortController | null = null

export type RegistrationResult = {
  mode: 'native' | 'polyfill' | 'unavailable'
  registered: string[]
}

/**
 * Register the whole surface, and say plainly which mode we ended up in.
 *
 * The polyfill is a development convenience, not a production fallback: shipping a shim to a browser
 * without the origin trial would report `polyfill` to a visitor whose agent still cannot see a single
 * tool, which is a more confusing lie than `unavailable`. So in production the answer is either the
 * real implementation or an honest banner.
 *
 * Async because `registerTool` returns a promise and every failure the spec defines arrives as a
 * rejection — not a thrown exception. A synchronous `try`/`catch` here caught nothing, so a page whose
 * agent cluster is not origin-keyed reported seventeen live tools while registering zero. That is the
 * failure next.config.mjs calls "the worst available failure", and this is the only place that can see
 * it.
 */
export async function registerTools(): Promise<RegistrationResult> {
  // Next.js renders this tree on the server too, where there is no document to register against.
  if (typeof document === 'undefined') return { mode: 'unavailable', registered: [] }

  // Fails fast on a copy-pasted name, which would otherwise shadow a tool silently at demo time.
  assertUniqueToolNames()

  const useShim = process.env.NODE_ENV !== 'production'
  const mode = document.modelContext || useShim ? installWebMcpPolyfill() : 'unavailable'

  const modelContext = document.modelContext
  if (!modelContext) return { mode: 'unavailable', registered: [] }

  /*
   * Abort any previous surface before opening a new one. React 19 mounts effects twice in
   * development, and hot reload re-runs this module — both leave a second set of tools registered
   * whose closures point at a Replayer that no longer exists. One controller owns everything, so
   * cleanup is one line and cannot half-happen.
   */
  controller?.abort()
  const surface = new AbortController()
  controller = surface

  /*
   * Concurrently, and `allSettled` rather than `all`: seventeen sequential awaits is seventeen round
   * trips through the host for no reason, and one host rejecting one schema must not cost us the other
   * sixteen. A surface that is sixteen-seventeenths present is worth having, and the banner shows what
   * actually registered rather than what we hoped would.
   *
   * `async` on the mapper is not decoration: a host that throws synchronously instead of rejecting
   * would otherwise escape `allSettled` through `map` and cost all seventeen.
   */
  const outcomes = await Promise.allSettled(
    allTools.map(async (tool) =>
      modelContext.registerTool(
        {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as unknown as Record<string, unknown>,
          execute: tool.execute,
          ...(tool.annotations ? { annotations: tool.annotations } : {}),
        },
        { signal: surface.signal },
      ),
    ),
  )

  /*
   * Between the await above and the writes below, an unmount or a second call may have aborted this
   * surface — which deregistered every tool that had resolved. Reporting those names now would put a
   * green banner over an empty tool list, and repopulating `polyfillRegistry` would resurrect closures
   * pointing at a Replayer that has already gone.
   */
  if (surface.signal.aborted) return { mode, registered: [] }

  const registered: string[] = []
  for (const [index, outcome] of outcomes.entries()) {
    const tool = allTools[index]
    if (tool === undefined) continue

    if (outcome.status === 'rejected') {
      const reason: unknown = outcome.reason
      const message = reason instanceof Error ? reason.message : String(reason)
      // eslint-disable-next-line no-console -- a rejected registration is invisible otherwise
      console.warn(`[traces] host rejected tool '${tool.name}': ${message}`)
      continue
    }

    registered.push(tool.name)

    // Keeps `window.tracesTools` useful in native mode, where the shim's registry never fills. After
    // the promise resolves, never alongside the call: an entry here for a tool the host refused is a
    // console handle that can call something no agent can see.
    polyfillRegistry.set(tool.name, tool)
  }

  return { mode, registered }
}

/** Deregisters everything. Idempotent. */
export function unregisterTools(): void {
  controller?.abort()
  controller = null
  polyfillRegistry.clear()
}

/**
 * Register a tool created in response to something the agent found.
 *
 * Optional, and the last thing to build (PLAN §4). Once a hypothesis is promoted, a
 * `verify_hypothesis_1` specific to that finding appears in the tool list — the surface itself
 * changing shape in response to the investigation. It demos in four seconds and it is the clearest
 * possible answer to "why does this need to be a live page rather than an API".
 *
 * TODO: Day 6 — only if every gate has passed.
 */
export function registerDynamicTool(_hypothesisId: string): void {
  throw new Error('registerDynamicTool: not implemented')
}

export { allTools }
