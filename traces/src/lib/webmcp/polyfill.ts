import type { ToolDefinition, ToolResponse } from './tool-types'

/**
 * A minimal stand-in for `document.modelContext` when the origin trial isn't available.
 *
 * Owner: Vicko.
 *
 * Good enough to build against; **not** good enough to judge a schema by. A polyfill will happily
 * accept a description that a real model misreads, so a tool is not "working" until it has been
 * called by an actual agent — see CONTRIBUTING.md, "Testing a tool".
 *
 * It also exposes `window.tracesTools` so tools can be called by hand from the devtools console:
 *
 *   await tracesTools.call('bisect', { selector: '#checkout button[type=submit]',
 *     predicate: { kind: 'propertyEquals', property: 'disabled', equals: true }, from: 0, to: 47000 })
 *
 * That console handle is how most of this project will actually get debugged, which is worth more
 * than it looks.
 */

export type TracesToolsHandle = {
  list: () => { name: string; description: string }[]
  call: (name: string, args?: Record<string, unknown>) => Promise<ToolResponse>
}

declare global {
  interface Window {
    tracesTools?: TracesToolsHandle
  }
}

/**
 * TODO(vicko), Day 1:
 *   - if `document.modelContext` exists, install nothing and return 'native' — never shadow the real
 *     implementation, or you will spend an afternoon debugging the polyfill's behaviour on a browser
 *     that had the real thing all along
 *   - otherwise define `document.modelContext` with `registerTool`, honouring `options.signal` by
 *     removing the tool on abort, and dispatching a `toolchange` event on every add and remove
 *   - always install `window.tracesTools`, native or not: the console handle is useful either way
 */
export function installWebMcpPolyfill(): 'native' | 'polyfill' {
  throw new Error('installWebMcpPolyfill: not implemented')
}

/** Registry backing the polyfill. Exported so the console handle and the shim share one source. */
export const polyfillRegistry = new Map<string, ToolDefinition>()
