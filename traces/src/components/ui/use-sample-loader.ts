'use client'

import { useCallback, useState } from 'react'
import { sampleRecordingUrl, type SampleRecording } from '@/components/ui/sample-recordings'
import { buildCheckpointIndex } from '@/lib/replay/checkpoint-index'
import { loadRecordingFile } from '@/lib/replay/load-recording-file'
import { sessionActions } from '@/lib/store/session'

/**
 * Fetching a sample recording into the store, with the loading and error states attached.
 *
 * Extracted from `RecordingPicker` when the empty state grew a one-click load of its own. Two copies of
 * this would have been two copies of the interesting part — `fetch` resolving happily on a 404, and the
 * decision that `id` and `label` come from `SAMPLE_RECORDINGS` rather than from the file — and the copy
 * that drifts is always the one nobody is looking at.
 *
 * Each caller holds its own instance, so the empty state's spinner does not appear in the header. That is
 * the right way round: the recording they load is the one that unmounts the empty state, so its own
 * feedback has to be local or it would report on a component that no longer exists.
 */

/**
 * Which recording failed, and why. `id` so the message can name the file rather than "the recording".
 *
 * Shared with `useFileLoader`, which reports the same two facts about a file a person chose, and lives
 * here rather than in a third module because this is where the shape and its consumers already were.
 *
 * `source` exists for one reason: the remedial hint. Both components used to end a failure with *"Samples
 * live in `traces/public/recordings/`"*, which is the correct next step for a missing sample and actively
 * wrong advice for a file the person picked off their own disk — it sends them to look in our repo for
 * their file. A failure has to be able to say which of the two it was, and colour cannot say it.
 */
export type RecordingLoadError = { id: string; message: string; source: 'sample' | 'file' }

export type SampleLoader = {
  load: (sample: SampleRecording) => Promise<void>
  /** The sample currently in flight, or null. Callers disable every button while this is set. */
  loadingId: string | null
  error: RecordingLoadError | null
}

export function useSampleLoader(): SampleLoader {
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [error, setError] = useState<RecordingLoadError | null>(null)

  const load = useCallback(async (sample: SampleRecording) => {
    const url = sampleRecordingUrl(sample.id)

    setLoadingId(sample.id)
    setError(null)

    try {
      const response = await fetch(url, { cache: 'no-store' })

      /** `fetch` resolves on 404, so a missing sample arrives here as a perfectly happy promise. */
      if (!response.ok) {
        throw new Error(`${url} — HTTP ${response.status} ${response.statusText}`.trim())
      }

      const file: unknown = await response.json()
      // `loadRecordingFile`, not `loadRecording`: the file on disk is the `{ id, label, events, … }`
      // wrapper the recorder writes, and it owns knowing that. `id` and `label` come from
      // `SAMPLE_RECORDINGS` so the file cannot relabel the UI on load.
      const recording = loadRecordingFile(sample.id, sample.label, file)
      const checkpoints = buildCheckpointIndex(recording.events, recording.startedAt)

      sessionActions().loadRecording(recording, checkpoints)
    } catch (cause) {
      setError({
        id: sample.id,
        message: cause instanceof Error ? cause.message : String(cause),
        source: 'sample',
      })
    } finally {
      setLoadingId(null)
    }
  }, [])

  return { load, loadingId, error }
}
