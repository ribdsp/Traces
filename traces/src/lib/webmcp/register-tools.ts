import { allTools } from './tools'

/**
 * The one place every tool is registered.
 *
 * Owner: Vicko.
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
 * TODO(vicko), Day 3:
 *   - install the polyfill first, then read `document.modelContext`
 *   - if it is still absent, return `unavailable` with an empty list and let the UI say so plainly —
 *     a banner naming the missing origin trial beats a page that looks fine and does nothing
 *   - register every entry in `allTools` with `{ signal: controller.signal }`
 *   - keep tools registered when no recording is loaded. They reply with a readable error instead;
 *     a tool that vanishes when idle makes the agent believe the capability doesn't exist
 */
export function registerTools(): RegistrationResult {
  throw new Error('registerTools: not implemented')
}

/** Deregisters everything. Idempotent. */
export function unregisterTools(): void {
  controller?.abort()
  controller = null
}

/**
 * Register a tool created in response to something the agent found.
 *
 * Optional, and the last thing to build (PLAN §4). Once a hypothesis is promoted, a
 * `verify_hypothesis_1` specific to that finding appears in the tool list — the surface itself
 * changing shape in response to the investigation. It demos in four seconds and it is the clearest
 * possible answer to "why does this need to be a live page rather than an API".
 *
 * TODO(vicko), Day 6, only if every gate has passed.
 */
export function registerDynamicTool(_hypothesisId: string): void {
  throw new Error('registerDynamicTool: not implemented')
}

export { allTools }
