import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SAMPLE_RECORDINGS } from '@/components/ui/sample-recordings'
import { loadRecordingFile } from './load-recording-file'

/**
 * The three committed recordings, through the exact function the picker calls.
 *
 * This is the test the 257 green ones did not cover: every other test in the suite builds its input
 * in memory, so nothing ever read `public/recordings/*.json` and handed it to the loader the way the
 * app does. The files are the serialised `Recording` wrapper, the loader accepts a bare event array,
 * and the mismatch was therefore invisible to unit tests and fatal on first click.
 *
 * Ids come from `SAMPLE_RECORDINGS` rather than a local list, so adding a manifest entry without
 * committing its file turns this red instead of shipping a picker button that throws.
 *
 * `fileURLToPath` and `path.join` rather than `new URL(..., import.meta.url)`: the jsdom test
 * environment replaces the global `URL`, and `fs` given one of those resolves to the wrong drive root.
 */
const RECORDINGS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../public/recordings',
)

const FULL_SNAPSHOT = 2
const META = 4

function readFileFor(id: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(RECORDINGS_DIR, `${id}.json`), 'utf8')) as unknown
}

describe('loadRecordingFile against the committed recordings', () => {
  for (const sample of SAMPLE_RECORDINGS) {
    describe(sample.id, () => {
      it('loads without throwing and keeps every event', () => {
        const raw = readFileFor(sample.id)
        const onDisk = (raw as { events: unknown[] }).events

        const recording = loadRecordingFile(sample.id, sample.label, raw)

        expect(recording.events).toHaveLength(onDisk.length)
        expect(recording.id).toBe(sample.id)
        expect(recording.label).toBe(sample.label)
      })

      it('derives a duration that matches its own first and last event', () => {
        const recording = loadRecordingFile(sample.id, sample.label, readFileFor(sample.id))
        const first = recording.events[0]
        const last = recording.events[recording.events.length - 1]

        expect(first).toBeDefined()
        expect(last).toBeDefined()
        expect(recording.durationMs).toBeGreaterThan(0)
        expect(recording.durationMs).toBe((last?.timestamp ?? 0) - (first?.timestamp ?? 0))
        expect(recording.startedAt).toBe(first?.timestamp)
      })

      it('is replayable and seekable: has a full snapshot and a meta event', () => {
        const recording = loadRecordingFile(sample.id, sample.label, readFileFor(sample.id))

        // A recording with no full snapshot has nothing to render; one with no meta event replays
        // every bisect probe from zero, because the seek fast path scans back for the last meta.
        expect(recording.events.some((event) => event.type === FULL_SNAPSHOT)).toBe(true)
        expect(recording.events.some((event) => event.type === META)).toBe(true)
      })

      it('derives meta from the events rather than trusting the file', () => {
        const raw = readFileFor(sample.id)
        const recording = loadRecordingFile(sample.id, sample.label, raw)

        // The `meta` on disk is partial — it carries `userAgent` and `viewport` and nothing else — so
        // `eventCount` is the assertion that catches a future version of this function forwarding the
        // file's own `meta` instead of recomputing it. `RecordingMeta` is a frozen contract; a
        // recording whose `eventCount` is `undefined` satisfies its type and breaks every consumer.
        expect(recording.meta.eventCount).toBe(recording.events.length)
        expect(recording.meta.recordingId).toBe(sample.id)
        expect(recording.meta.durationMs).toBe(recording.durationMs)
        expect(recording.meta.viewport.width).toBeGreaterThan(0)
        expect(recording.meta.viewport.height).toBeGreaterThan(0)
      })
    })
  }
})
