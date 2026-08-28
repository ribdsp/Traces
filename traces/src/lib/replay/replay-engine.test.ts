import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SAMPLE_RECORDINGS } from '@/components/ui/sample-recordings'
import { loadRecordingFile } from './load-recording-file'
import { earliestSeekableMs } from './replay-engine'

/**
 * `createReplayEngine` itself is deliberately untested — see the note on it: jsdom implements neither
 * the iframe document lifecycle nor layout, so a test here would pass or fail on the stand-in rather
 * than on rrweb. `earliestSeekableMs` is the exception. It is pure arithmetic over the event list, it
 * is the difference between `read_dom_at(0)` returning the start of the session and returning whatever
 * the previous seek left in the iframe, and it is the part a future change to the recorder's snapshot
 * timing could silently invalidate.
 *
 * The clamp itself was measured in a browser against all three recordings — every offset up to and
 * including the first full snapshot's own left the DOM stale, and one millisecond later was correct.
 * `earliestSeekableMs` returns that first correct offset, so the numbers those runs produced are the
 * ones asserted below, and a regression in either the arithmetic or the fixtures shows up here.
 *
 * `fileURLToPath` and `path.join` rather than `new URL(..., import.meta.url)`: the jsdom test
 * environment replaces the global `URL`, and `fs` given one of those resolves to the wrong drive root.
 */
const RECORDINGS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../public/recordings',
)

const META = 4
const FULL_SNAPSHOT = 2

function realRecording(id: string, label: string) {
  const raw = JSON.parse(fs.readFileSync(path.join(RECORDINGS_DIR, `${id}.json`), 'utf8')) as unknown
  return loadRecordingFile(id, label, raw)
}

describe('earliestSeekableMs', () => {
  it('is one past the first full snapshot, because rrweb replays events strictly before the target', () => {
    const recording = loadRecordingFile('slug', 'Label', [
      { type: META, timestamp: 5000, data: { href: 'http://localhost/', width: 1280, height: 720 } },
      { type: FULL_SNAPSHOT, timestamp: 5021, data: {} },
      { type: 3, timestamp: 9000, data: { source: 0 } },
    ])

    expect(earliestSeekableMs(recording)).toBe(22)
  })

  it('is relative to the recording, not to the epoch', () => {
    const recording = loadRecordingFile('slug', 'Label', [
      { type: META, timestamp: 1_700_000_000_000, data: { href: 'http://x/', width: 8, height: 8 } },
      { type: FULL_SNAPSHOT, timestamp: 1_700_000_000_030, data: {} },
    ])

    expect(earliestSeekableMs(recording)).toBe(31)
  })

  it('uses the first full snapshot, not a later checkout', () => {
    const recording = loadRecordingFile('slug', 'Label', [
      { type: META, timestamp: 1000, data: { href: 'http://x/', width: 8, height: 8 } },
      { type: FULL_SNAPSHOT, timestamp: 1015, data: {} },
      { type: META, timestamp: 6000, data: { href: 'http://x/', width: 8, height: 8 } },
      { type: FULL_SNAPSHOT, timestamp: 6000, data: {} },
    ])

    expect(earliestSeekableMs(recording)).toBe(16)
  })

  it('is not zero for any committed recording, which is the whole reason it exists', () => {
    for (const sample of SAMPLE_RECORDINGS) {
      const recording = realRecording(sample.id, sample.label)

      // If this were 0 the clamp would be a no-op and `read_dom_at(0)` would go back to reporting
      // whatever the previous seek left behind.
      expect(earliestSeekableMs(recording)).toBeGreaterThan(0)
      // And it has to stay small, or the clamp would be hiding real early activity behind the seek.
      expect(earliestSeekableMs(recording)).toBeLessThan(100)
    }
  })

  it('matches the first offset that rebuilt the DOM in the browser, for each committed recording', () => {
    // Meta at 0 ms, full snapshot at 17-21 ms: rrweb walks the document after stamping the meta event.
    // Below each of these the measured DOM was still the previous seek's; at it, the snapshot was back.
    const expected: Record<string, number> = {
      'empty-province': 22,
      'race-condition': 18,
      'overlay-blocks-button': 21,
    }

    for (const sample of SAMPLE_RECORDINGS) {
      expect(earliestSeekableMs(realRecording(sample.id, sample.label))).toBe(expected[sample.id])
    }
  })
})
