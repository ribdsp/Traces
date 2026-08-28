import { afterEach, describe, expect, it, vi } from 'vitest'
import { allTools } from './tools'
import { polyfillRegistry } from './polyfill'
import { registerTools, unregisterTools } from './register-tools'

/**
 * Registration is only allowed to report what the host actually accepted.
 *
 * These exist because of a specific bug rather than for coverage. `registerTool` returns a promise and
 * every failure the spec defines — `InvalidStateError`, `SecurityError` for an agent cluster that is not
 * origin-keyed, `NotAllowedError`, a duplicate name, a bad schema — arrives as a *rejection*. The old
 * implementation wrapped the call in a synchronous `try`/`catch`, which caught none of them: all sixteen
 * names went into `registered` unconditionally and the banner read "WebMCP live · 16 tools" over an empty
 * tool list. A green banner on a dead surface is the one failure this project cannot afford, so the
 * assertion below is about the *absence* of names, not the presence of them.
 *
 * `polyfillRegistry` is checked alongside `registered` because it is the second half of the same lie: an
 * entry there is a tool `window.tracesTools.call()` will happily invoke, and an entry for a tool the host
 * refused is a console handle that works while no agent can see the tool at all.
 */

/** A host that rejects the named tools and accepts the rest, always asynchronously. */
function stubModelContext(reject: {
  names: readonly string[]
  error: () => unknown
}): ModelContext {
  return Object.assign(new EventTarget(), {
    async registerTool(descriptor: ModelContextToolDescriptor): Promise<void> {
      // A tick before deciding, so a synchronous `try`/`catch` could not see this even by accident.
      await Promise.resolve()
      if (reject.names.includes(descriptor.name)) throw reject.error()
    },
    async getTools(): Promise<RegisteredTool[]> {
      return []
    },
  })
}

afterEach(() => {
  unregisterTools()
  delete document.modelContext
  vi.restoreAllMocks()
})

describe('registerTools', () => {
  const REFUSED = 'read_dom_at'

  it('leaves a rejected tool out of `registered` and out of `polyfillRegistry`', async () => {
    // Arrange: a host that refuses exactly one tool, the way a real one refuses a schema it dislikes.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    document.modelContext = stubModelContext({
      names: [REFUSED],
      error: () => new DOMException('agent cluster is not origin-keyed', 'SecurityError'),
    })

    // Act
    const result = await registerTools()

    // Assert
    expect(result.mode).toBe('native')
    expect(result.registered).not.toContain(REFUSED)
    expect(result.registered).toHaveLength(allTools.length - 1)
    expect(polyfillRegistry.has(REFUSED)).toBe(false)

    // The other fifteen are unaffected — a refused schema must not cost the rest of the surface.
    for (const tool of allTools) {
      if (tool.name === REFUSED) continue
      expect(result.registered, tool.name).toContain(tool.name)
      expect(polyfillRegistry.has(tool.name), tool.name).toBe(true)
    }

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain(REFUSED)
    expect(warn.mock.calls[0]?.[0]).toContain('agent cluster is not origin-keyed')
  })

  it('reports nothing registered when the host refuses everything', async () => {
    // The failure next.config.mjs calls "the worst available failure": an origin that is not
    // origin-keyed refuses every tool, and the banner used to call that sixteen live tools.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    document.modelContext = stubModelContext({
      names: allTools.map((tool) => tool.name),
      error: () => new DOMException('the tools permission policy forbids registration', 'NotAllowedError'),
    })

    const result = await registerTools()

    expect(result.registered).toEqual([])
    expect(polyfillRegistry.size).toBe(0)
  })

  it('registers the whole surface when the host accepts it', async () => {
    document.modelContext = stubModelContext({ names: [], error: () => new Error('unreachable') })

    const result = await registerTools()

    expect(result.registered).toEqual(allTools.map((tool) => tool.name))
    expect(polyfillRegistry.size).toBe(allTools.length)
  })

  it('reports nothing once the surface has been aborted mid-registration', async () => {
    // React 19 mounts effects twice: the first pass is aborted on cleanup, which deregisters whatever
    // had resolved. Naming those tools afterwards would put a green banner over a surface that is gone.
    document.modelContext = stubModelContext({ names: [], error: () => new Error('unreachable') })

    const pending = registerTools()
    unregisterTools()

    expect((await pending).registered).toEqual([])
    expect(polyfillRegistry.size).toBe(0)
  })
})
