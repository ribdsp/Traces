import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createCache, createMirror, rebuild } from 'rrweb-snapshot'
import { MAX_CHARS, MAX_LINES, compressDom } from './compress-dom'

/**
 * The budget, against the three real sample recordings.
 *
 * `compress-dom.test.ts` and `compress-dom.budget.test.ts` prove the 60-line / 1,200-character budget on
 * hand-written fixtures, which is a weaker claim than the one the product makes: PRD A1 is "`read_dom_at`
 * returns <= 60 lines on all three sample recordings", and a fixture is a tree we wrote to be compressible.
 * These recordings are real rrweb output from a real Chrome driving the demo app, so this file is the
 * acceptance criterion rather than a restatement of the unit tests.
 *
 * The DOM at an instant is reconstructed the same way `scripts/measure-compression.mjs` does it, and for
 * the same reason: `rrweb-snapshot`'s `rebuild()` — the serializer rrweb's own replayer uses — applied to a
 * **genuine FullSnapshot event**. No mutations are replayed and nothing is hand-built, so the tree here is
 * exactly what rrweb captured. The numbers quoted in README.md and docs/agent-legible-dom.md come from
 * that script; this file is the part CI has to keep true.
 *
 * Every full snapshot in every recording is checked, not one per file. Rebuilding is a few milliseconds,
 * and "the budget holds at the instant we chose to measure" is the claim a demo makes, not the claim a
 * guarantee makes.
 */

/** The container the DOM tools scope to on this app's checkout. Present from ~10s in every recording. */
const SCOPE = 'form#checkout'

const RECORDINGS = ['empty-province', 'race-condition', 'overlay-blocks-button'] as const

/** rrweb's FullSnapshot. Spelled out rather than imported, so this file depends only on `compress-dom`. */
const FULL_SNAPSHOT = 2

type SerializedNode = Parameters<typeof rebuild>[0]
type RecordedEvent = { type: number; timestamp: number; data: { node: SerializedNode } }
type Loaded = {
  /** Recording-relative time base, the same one `loadRecording` uses: the first event's timestamp. */
  startedAt: number
  snapshots: RecordedEvent[]
}

/**
 * `fileURLToPath` and `path.join` rather than `new URL(..., import.meta.url)`: the jsdom test
 * environment replaces the global `URL`, and `fs` given one of those resolves to the wrong drive root.
 */
const RECORDINGS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../public/recordings')

function loadSnapshots(slug: string): Loaded {
  const file = path.join(RECORDINGS_DIR, `${slug}.json`)
  // The file is the `{ id, label, events, ... }` wrapper; the raw event array is `json.events`.
  const wrapper = JSON.parse(fs.readFileSync(file, 'utf8')) as { events: RecordedEvent[] }
  const events = [...wrapper.events].sort((left, right) => left.timestamp - right.timestamp)
  return {
    startedAt: events[0]?.timestamp ?? 0,
    snapshots: events.filter((event) => event.type === FULL_SNAPSHOT),
  }
}

/**
 * Rebuild one snapshot into a detached document.
 *
 * `createHTMLDocument` rather than this test file's own `document`: it has no `defaultView`, which is both
 * what rrweb-snapshot >= 2.1 requires before it will rebuild without `UNSAFE_allowUnprotectedRebuild`, and
 * a guarantee that a recording cannot reach the test realm.
 */
function rebuildInto(snapshot: RecordedEvent): Document {
  const doc = document.implementation.createHTMLDocument('replay')
  rebuild(snapshot.data.node, { doc, cache: createCache(), mirror: createMirror() })
  return doc
}

describe('compressDom on the real sample recordings', () => {
  for (const slug of RECORDINGS) {
    it(`stays inside the budget at every full snapshot of ${slug}`, () => {
      const { startedAt, snapshots } = loadSnapshots(slug)
      expect(snapshots.length).toBeGreaterThan(0)

      let measured = 0

      for (const snapshot of snapshots) {
        const root = rebuildInto(snapshot).querySelector(SCOPE)
        // The first snapshots are the cart page, which has no checkout form and nothing to scope to.
        if (root === null) continue
        measured += 1

        const atMs = snapshot.timestamp - startedAt
        const result = compressDom({ root, atMs })
        const where = `${slug} at ${atMs}ms`

        expect(result.lineCount, `${where}: ${result.lineCount} lines`).toBeLessThanOrEqual(MAX_LINES)
        expect(result.charCount, `${where}: ${result.charCount} chars`).toBeLessThanOrEqual(MAX_CHARS)
        expect(result.charCount, `${where}: empty output`).toBeGreaterThan(0)
        // The ratio the docs quote is `sourceCharCount / charCount`, so it has to be the scope's own size.
        expect(result.sourceCharCount, where).toBe(root.outerHTML.length)
        expect(result.charCount, `${where}: no compression`).toBeLessThan(result.sourceCharCount)
      }

      expect(measured, `${slug}: no snapshot contained ${SCOPE}`).toBeGreaterThan(0)
    })
  }

  /**
   * The primary sample, at the instant README.md and docs/agent-legible-dom.md quote: 38,048 ms into
   * `empty-province`, the moment the province list is empty, `aria-invalid` is set and the error is on
   * screen. Asserted as content rather than as exact character counts — the counts belong to
   * `scripts/measure-compression.mjs`, but "the bug is legible inside the budget" is the guarantee, and the
   * three lines that carry it are worth naming.
   */
  it('renders the empty-province bug legibly at the instant the docs quote', () => {
    const criticalMs = 38_048
    const { startedAt, snapshots } = loadSnapshots('empty-province')
    const snapshot = snapshots.find((event) => event.timestamp - startedAt === criticalMs)
    if (snapshot === undefined) {
      throw new Error(`empty-province has no full snapshot at ${criticalMs}ms — the recording changed.`)
    }

    const root = rebuildInto(snapshot).querySelector(SCOPE)
    if (root === null) {
      throw new Error(`empty-province at ${criticalMs}ms no longer contains ${SCOPE}.`)
    }

    const result = compressDom({ root, atMs: criticalMs })

    expect(result.truncated).toBe(false)
    expect(result.dom).toContain('select#province[name=province] [empty options: 0]')
    expect(result.dom).toContain('[DISABLED]')
    expect(result.dom).toContain('aria-invalid=true')
    // Tailwind's utility soup is in the raw markup and must not be in the output.
    expect(root.outerHTML).toContain('border-gray-300')
    expect(result.dom).not.toContain('border-gray-300')
  })
})
