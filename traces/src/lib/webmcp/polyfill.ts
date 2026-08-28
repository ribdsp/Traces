import type { ToolDefinition, ToolResponse } from './tool-types'

/**
 * A minimal stand-in for `document.modelContext` when the origin trial isn't available.
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
 * Install the shim, unless the browser already has the real thing.
 *
 * Assumes `document` exists — the only caller is `registerTools`, which checks that first, because
 * this runs from a client effect and Next.js renders the tree on the server too.
 */
export function installWebMcpPolyfill(): 'native' | 'polyfill' {
  // Useful in both modes, so it goes in before the branch.
  installConsoleHandle()

  /*
   * Never shadow a working implementation. Installing over a live origin trial means every bug you
   * then chase is a bug in this file, on a browser that had the genuine article the whole time — and
   * nothing about the symptoms tells you which of the two you are looking at.
   */
  if (document.modelContext) return 'native'

  const shim: ModelContext = Object.assign(new EventTarget(), {
    registerTool(descriptor: ModelContextToolDescriptor, options?: ModelContextRegisterOptions): void {
      /*
       * The spec's descriptor type is wider than what we register: `inputSchema` is an opaque
       * `Record<string, unknown>` there and a checked `ToolInputSchema` in ours. Every caller is
       * register-tools.ts passing one of our own `allTools` entries, so narrowing here is a statement
       * about this codebase rather than about the spec.
       */
      polyfillRegistry.set(descriptor.name, descriptor as unknown as ToolDefinition)
      shim.dispatchEvent(new Event('toolchange'))

      options?.signal?.addEventListener('abort', () => {
        polyfillRegistry.delete(descriptor.name)
        shim.dispatchEvent(new Event('toolchange'))
      })
    },
  })

  document.modelContext = shim
  return 'polyfill'
}

/**
 * The devtools console handle.
 *
 * Installed in every mode, because this is how most of this project will actually get debugged — long
 * before any agent is connected, and without waiting for the inspector extension.
 */
function installConsoleHandle(): void {
  window.tracesTools = {
    list: () =>
      [...polyfillRegistry.values()].map((tool) => ({ name: tool.name, description: tool.description })),

    call: async (name, args = {}) => {
      const tool = polyfillRegistry.get(name)
      if (!tool) {
        const known = [...polyfillRegistry.keys()].join(', ') || 'none registered yet'
        throw new Error(`No tool named '${name}'. Registered: ${known}.`)
      }
      return tool.execute(args)
    },
  }
}

/** Registry backing the polyfill. Exported so the console handle and the shim share one source. */
export const polyfillRegistry = new Map<string, ToolDefinition>()
