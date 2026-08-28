/**
 * Shared shapes and response helpers for the tool surface.
 *
 * The single most consequential fact about WebMCP tool responses: `content` accepts `"text"` and, as
 * of the current draft, nothing else. An `"image"` content type is an open question. That is not a
 * detail — it is the constraint that produced the agent-legible DOM compressor and
 * `ask_human_visual`, and it means every response here is a string a model has to read.
 */

export type ToolResponse = {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

/**
 * The subset of JSON Schema these tools use.
 *
 * Deliberately narrow. A `Record<string, unknown>` would accept every schema we might ever write and
 * also every typo, and the failure mode of a mistyped schema key is silent: the host ignores it, the
 * model never sees the constraint, and the tool looks like it works until something calls it wrong.
 */
export type JsonSchemaNode = {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array'
  /** Written for a model. One sentence on what the field means, plus an example when the format is not obvious. */
  description?: string
  enum?: readonly (string | number)[]
  items?: JsonSchemaNode
  properties?: Record<string, JsonSchemaNode>
  required?: readonly string[]
  additionalProperties?: boolean
  minimum?: number
  maximum?: number
}

/**
 * Every tool takes an object, and `additionalProperties: false` is required rather than optional: a
 * closed schema turns a hallucinated argument into an error the model can correct, where an open one
 * turns it into silence.
 */
export type ToolInputSchema = {
  type: 'object'
  properties: Record<string, JsonSchemaNode>
  required?: readonly string[]
  additionalProperties: false
}

export type ToolDefinition = {
  name: string
  /**
   * Part of the interface, not documentation. A tool whose description doesn't say *when* to use it
   * gets used at the wrong moment, and that reads to a judge as a broken product rather than a
   * vague sentence. `ask_human_visual` in particular must state that the agent cannot see rendered
   * output, or models reach for it as a general-purpose escape from uncertainty.
   */
  description: string
  inputSchema: ToolInputSchema
  execute: (args: Record<string, unknown>) => Promise<ToolResponse>
  /**
   * The spec's `ToolAnnotations` hints, forwarded to the host by `registerTools`.
   *
   * Omitted where both hints would be `false`, which is their spec default — a block saying nothing is
   * worse than no block, because it reads as a judgement that was made. So absence here means "this
   * tool changes something, and its result carries none of the recorded page's own text", and every
   * present block carries the reason it is set.
   */
  annotations?: ToolAnnotations
}

/** Plain prose for a model. */
export function text(body: string): ToolResponse {
  return { content: [{ type: 'text', text: body }] }
}

/**
 * Structured data for a model.
 *
 * Indented with two spaces rather than minified: the token cost is small and models read nested
 * JSON noticeably more reliably when it is indented.
 */
export function json(payload: unknown): ToolResponse {
  return text(JSON.stringify(payload, null, 2))
}

/**
 * A failure the agent is expected to recover from.
 *
 * Never throw out of `execute`. A thrown exception reaches the model as a host-level failure it can
 * only report, whereas a sentence naming what was wrong and what is accepted gets corrected on the
 * next call. `isError` marks it as a failure without ending the conversation.
 */
export function toolError(message: string): ToolResponse {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/** The standard "no recording loaded" reply. Tools stay registered when idle; they explain instead. */
export function noRecording(): ToolResponse {
  return toolError(
    'No recording is loaded. Ask the human to pick one of the sample recordings first, then call read_session_meta.',
  )
}

/** Placeholder while a tool is being built, so the surface is inspectable before it is complete. */
export function notImplemented(name: string): ToolResponse {
  return toolError(`Tool '${name}' is registered but not implemented yet.`)
}

/** Read a required string argument without reaching for `any`. */
export function requireString(
  args: Record<string, unknown>,
  key: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const value = args[key]
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, error: `'${key}' is required and must be a non-empty string.` }
  }
  return { ok: true, value }
}

/** Read a required number argument, rejecting NaN and Infinity along with the wrong type. */
export function requireNumber(
  args: Record<string, unknown>,
  key: string,
): { ok: true; value: number } | { ok: false; error: string } {
  const value = args[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, error: `'${key}' is required and must be a finite number of milliseconds.` }
  }
  return { ok: true, value }
}
