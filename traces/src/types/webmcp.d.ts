/**
 * Ambient declarations for the WebMCP draft API.
 *
 * Hand-written because the spec is a W3C draft and there is no stable `@types` package yet. Keep this
 * narrow: only what we actually call. A speculative surface here would be TypeScript telling us that
 * something works when the browser disagrees.
 *
 * Spec: `document.modelContext.registerTool()`. Available behind an origin trial in Chrome 149+ and
 * Edge 150+, and via the polyfill in src/lib/webmcp/polyfill.ts everywhere else.
 */

interface ModelContextToolResponseContent {
  type: 'text'
  text: string
}

interface ModelContextToolResponse {
  content: ModelContextToolResponseContent[]
  isError?: boolean
}

interface ModelContextToolDescriptor {
  name: string
  description: string
  /** JSON Schema. `unknown` rather than a modelled schema type: it is data, not a contract we own. */
  inputSchema: Record<string, unknown>
  execute: (args: Record<string, unknown>) => Promise<ModelContextToolResponse>
}

interface ModelContextRegisterOptions {
  /** Deregisters the tool when aborted. Traces uses one controller for the whole surface. */
  signal?: AbortSignal
  /** Which agents may see the tool. Omitted means the host default. */
  exposedTo?: string[]
}

interface ModelContext extends EventTarget {
  registerTool: (
    descriptor: ModelContextToolDescriptor,
    options?: ModelContextRegisterOptions,
  ) => void
}

interface Document {
  /** Absent unless the origin trial is active or the polyfill has installed itself. */
  modelContext?: ModelContext
}
