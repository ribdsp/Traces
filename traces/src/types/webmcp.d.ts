/**
 * Ambient declarations for the WebMCP draft API.
 *
 * Hand-written because the spec is a W3C draft and there is no stable `@types` package yet. Keep this
 * narrow: only what we actually call. A speculative surface here would be TypeScript telling us that
 * something works when the browser disagrees.
 *
 * Spec: `document.modelContext.registerTool()`. Available behind an origin trial in Chrome 149+ and
 * Edge 150+, and via the polyfill in src/lib/webmcp/polyfill.ts everywhere else.
 *
 * Still narrow on purpose: `executeTool` and the `toolcall` event are in the draft and absent here,
 * because Traces is the page that *offers* tools, never the one that calls someone else's.
 */

interface ModelContextToolResponseContent {
  type: 'text'
  text: string
}

interface ModelContextToolResponse {
  content: ModelContextToolResponseContent[]
  isError?: boolean
}

/**
 * Hints about what calling a tool costs, from the spec's `ToolAnnotations` dictionary.
 *
 * Both default to `false`, so an omitted `annotations` block claims nothing. Set a flag only where it
 * is true of the tool: `readOnlyHint` on everything says nothing, and `untrustedContentHint` on
 * everything trains a host to ignore it on the calls that matter.
 */
interface ToolAnnotations {
  /** The tool changes nothing a human or another tool can observe afterwards. */
  readOnlyHint?: boolean
  /**
   * The result may carry content this origin did not author — for Traces, text out of the recorded
   * page. Prompt injection is the reason the flag exists; the content is a bug report's evidence, not
   * an instruction.
   */
  untrustedContentHint?: boolean
}

interface ModelContextToolDescriptor {
  name: string
  /** Human-facing label. The host may show it instead of `name`; `description` is what a model reads. */
  title?: string
  description: string
  /** JSON Schema. `unknown` rather than a modelled schema type: it is data, not a contract we own. */
  inputSchema: Record<string, unknown>
  /**
   * The second argument is the host's per-call abort signal, distinct from the registration signal in
   * `ModelContextRegisterOptions`: that one deregisters the tool, this one cancels one invocation.
   */
  execute: (
    args: Record<string, unknown>,
    options: { signal: AbortSignal },
  ) => Promise<ModelContextToolResponse>
  annotations?: ToolAnnotations
}

interface ModelContextRegisterOptions {
  /** Deregisters the tool when aborted. Traces uses one controller for the whole surface. */
  signal?: AbortSignal
  /** Which agents may see the tool. Omitted means the host default. */
  exposedTo?: string[]
}

/**
 * A tool as the host reports it back, which is not the descriptor that went in: `execute` is gone, and
 * `origin`/`window` say which frame registered it.
 */
interface RegisteredTool {
  name: string
  title?: string
  description: string
  inputSchema?: Record<string, unknown>
  origin: string
  window: Window
  annotations?: ToolAnnotations
}

interface ModelContext extends EventTarget {
  /**
   * Resolves once the tool is live, and **rejects** for every failure: `InvalidStateError` for a
   * document that is not fully active, `SecurityError` for an agent cluster that is not origin-keyed,
   * `NotAllowedError` when the `tools` permission policy forbids it, plus a duplicate name, an empty
   * name or description, and an invalid `inputSchema`.
   *
   * Typed as a promise rather than `void` because that is the difference between reporting sixteen
   * live tools and reporting sixteen that a `try`/`catch` never saw fail.
   */
  registerTool: (
    descriptor: ModelContextToolDescriptor,
    options?: ModelContextRegisterOptions,
  ) => Promise<void>
  /** What the host believes is registered. `fromOrigins` filters to specific frames. */
  getTools: (options?: { fromOrigins?: string[] }) => Promise<RegisteredTool[]>
}

interface Document {
  /** Absent unless the origin trial is active or the polyfill has installed itself. */
  modelContext?: ModelContext
}
