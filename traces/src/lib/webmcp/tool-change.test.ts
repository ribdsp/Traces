import { afterEach, describe, expect, it, vi } from 'vitest'
import { onToolChange, resetToolChangeWarnings } from './tool-change'

/**
 * A host without events must not be able to take the page down.
 *
 * This exists because of a specific production failure rather than for coverage. `ModelContext` is
 * declared `: EventTarget` in the spec, so `types/webmcp.d.ts` types the event methods as present and
 * both `tool-status-banner.tsx` and `webmcp-badge.tsx` called them directly. ChatGPT Desktop's in-app
 * browser exposes a `document.modelContext` that is not an `EventTarget`, so the call threw
 * `TypeError: e.addEventListener is not a function` out of a client effect, React escalated it, and the
 * production build served its global error page — the whole of Traces replaced by "Application error"
 * in the only browser with native WebMCP, which is the browser the challenge rules point judges at.
 *
 * So the assertions below are about *not throwing* and about the subscription being optional. A version
 * of `onToolChange` that propagates the TypeError passes nothing here.
 */

/** A host with `registerTool` and `getTools` and no event methods at all — ChatGPT Desktop's shape. */
function eventlessHost(): ModelContext {
  return {
    async registerTool(): Promise<void> {},
    async getTools(): Promise<RegisteredTool[]> {
      return []
    },
  } as unknown as ModelContext
}

afterEach(() => {
  resetToolChangeWarnings()
  vi.restoreAllMocks()
})

describe('onToolChange', () => {
  it('does not throw on a host that is not an EventTarget, and its unsubscribe is safe to call', () => {
    // Arrange: the host shape that crashed production, and a listener that must never be reached.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const listener = vi.fn()

    // Act
    const unsubscribe = onToolChange(eventlessHost(), listener)

    // Assert: the page survives, nothing was subscribed, and cleanup is still callable.
    expect(() => unsubscribe()).not.toThrow()
    expect(listener).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('delivers toolchange and stops after unsubscribe on a host that is an EventTarget', () => {
    // Arrange: a spec-shaped host, so the happy path is proven and not merely assumed.
    const host = Object.assign(new EventTarget(), {
      async registerTool(): Promise<void> {},
      async getTools(): Promise<RegisteredTool[]> {
        return []
      },
    }) as ModelContext
    const listener = vi.fn()

    // Act
    const unsubscribe = onToolChange(host, listener)
    host.dispatchEvent(new Event('toolchange'))
    unsubscribe()
    host.dispatchEvent(new Event('toolchange'))

    // Assert: exactly one delivery — the second event lands after cleanup.
    expect(listener).toHaveBeenCalledOnce()
  })

  it('survives a host whose addEventListener throws', () => {
    // Arrange: the same class of fault one method over, which the typeof guard alone would not catch.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const host = {
      addEventListener() {
        throw new TypeError('Illegal invocation')
      },
      removeEventListener() {},
    } as unknown as ModelContext

    // Act & Assert
    expect(() => onToolChange(host, vi.fn())).not.toThrow()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns once for a repeated fault rather than once per subscriber', () => {
    // Arrange: two components subscribe, and both remount under React 19's double invoke.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Act
    onToolChange(eventlessHost(), vi.fn())
    onToolChange(eventlessHost(), vi.fn())

    // Assert: four identical lines would read as four separate faults.
    expect(warn).toHaveBeenCalledOnce()
  })
})
