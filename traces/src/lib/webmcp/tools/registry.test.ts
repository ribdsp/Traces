import { describe, expect, it } from 'vitest'
import { allTools, assertUniqueToolNames } from './index'

/**
 * Guards on the tool registry itself, not on any tool's behaviour.
 *
 * These are the checks that would otherwise be caught by a model at demo time: a tool that quietly
 * shadows another because a name got copy-pasted, a schema with no field descriptions, a description
 * that still reads like a TODO. None of it needs a browser, so it can run on every commit.
 *
 * All 16 tools are implemented and every assertion below is green. That is the state to keep: these
 * ran as a checklist while the tools were being filled in, and they read now as the standing rules a
 * seventeenth tool has to meet before it joins `allTools`.
 */
describe('tool registry', () => {
  it('has no duplicate names', () => {
    expect(() => assertUniqueToolNames()).not.toThrow()
  })

  it('exposes the 16 tools documented in docs/tools.md', () => {
    expect(allTools).toHaveLength(16)
  })

  it('uses snake_case names, which is what the spec examples use', () => {
    for (const tool of allTools) {
      expect(tool.name, tool.name).toMatch(/^[a-z][a-z0-9_]*$/)
    }
  })

  it('describes every tool in a way a model can act on', () => {
    for (const tool of allTools) {
      // Short descriptions are the single most common cause of a wrong tool call: the model picks on
      // vibes because there is nothing else to go on.
      expect(tool.description.length, tool.name).toBeGreaterThan(80)
      expect(tool.description, tool.name).not.toMatch(/TODO|FIXME|tbd/i)
    }
  })

  it('describes every input field', () => {
    for (const tool of allTools) {
      for (const [field, schema] of Object.entries(tool.inputSchema.properties)) {
        expect(schema.description, `${tool.name}.${field}`).toBeTruthy()
      }
    }
  })

  it('only requires fields it actually declares', () => {
    // A required field missing from `properties` is invisible to the model and mandatory to the host:
    // every call fails, and nothing in the tool list explains why.
    for (const tool of allTools) {
      for (const field of tool.inputSchema.required ?? []) {
        expect(Object.keys(tool.inputSchema.properties), `${tool.name}.${field}`).toContain(field)
      }
    }
  })
})
