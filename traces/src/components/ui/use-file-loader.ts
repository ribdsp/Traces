'use client'

import { useCallback, useEffect, useState } from 'react'
import { deriveRecordingName } from '@/components/ui/recording-name'
import type { RecordingLoadError } from '@/components/ui/use-sample-loader'
import { buildCheckpointIndex } from '@/lib/replay/checkpoint-index'
import { loadRecordingFile } from '@/lib/replay/load-recording-file'
import { reportError } from '@/components/ui/error-toast'
import { sessionActions } from '@/lib/store/session'

/**
 * Reading a recording a person chose off their own disk into the store.
 *
 * Sibling of `useSampleLoader`, and shaped like it on purpose: same three fields, same `finally`, same
 * error type. The only difference between them is where the JSON comes from — a `fetch` of a file we
 * shipped, or a `File` somebody handed us — and everything after that point is the same three lines.
 *
 * There is no upload here and there is nowhere to upload to. `file.text()` reads the bytes in this tab,
 * `JSON.parse` turns them into a value, and the value goes into a client-side store. That is worth
 * stating in code as well as in the UI, because "load a file" is a phrase that normally means the
 * opposite.
 *
 * **No confirmation dialog before replacing an open recording**, deliberately. The store's
 * `loadRecording` resets to `initialState` — read its docstring: a marker at 28.412s of a *different*
 * recording is wrong data rather than stale data, so carrying findings over would be the bug. Loading a
 * sample already discards them with no prompt and logs the swap to the activity feed. Prompting on one
 * of the two paths and not the other would teach that the two do different things.
 */

/**
 * The ceiling on a file we will even read.
 *
 * The guard is not about our own memory so much as about the tab: `file.text()` on a multi-gigabyte
 * drop resolves eventually or not at all, and in the meantime nothing on the page responds, including
 * whatever the agent was in the middle of. Refusing in a sentence is strictly better than a frozen tab.
 *
 * 64 MB is generous rather than tight — the three samples in `traces/public/recordings/` are about
 * 200 KB each for 45 seconds — so a real recording of a long session still loads and only something
 * that is not a recording is turned away.
 */
export const MAX_RECORDING_BYTES = 64 * 1024 * 1024

const BYTES_PER_MB = 1024 * 1024

/** Both sides of the size message use this, so the number and the cap are never in different units. */
function megabytes(bytes: number): string {
  return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`
}

export type FileLoader = {
  load: (file: File) => Promise<void>
  /** The file currently being parsed, by name, or null. Callers disable their controls while set. */
  loadingName: string | null
  error: RecordingLoadError | null
}

export function useFileLoader(): FileLoader {
  const [loadingName, setLoadingName] = useState<string | null>(null)
  const [error, setError] = useState<RecordingLoadError | null>(null)

  /**
   * Stop the browser navigating this tab to a dropped file.
   *
   * This listener is not part of the drop feature and does not become unnecessary if the affordance is
   * removed. With no `dragover` handler anywhere, dropping a JSON file on the window is a *navigation*:
   * the tab becomes a view of `file:///…`, and the investigation on it — every marker and hypothesis the
   * agent produced, none of which is persisted unless `snapshot_finding` was called — is gone. A missed
   * drop should do nothing, which is what these two lines buy.
   *
   * Both events are needed, and `dragover` is the non-obvious one: the browser only delivers `drop` to a
   * target that cancelled the drag over it, so without the first handler the second never runs and the
   * navigation happens anyway.
   *
   * It lives in the hook rather than in a component so that whichever caller is mounted installs it.
   * `RecordingPicker` is in the header and never unmounts, so in practice the guard is up for the life
   * of the page; the empty state's instance adds a second, redundant, harmless one while it is on
   * screen. `preventDefault` twice is `preventDefault`.
   */
  useEffect(() => {
    const swallow = (event: DragEvent) => event.preventDefault()

    window.addEventListener('dragover', swallow)
    window.addEventListener('drop', swallow)
    return () => {
      window.removeEventListener('dragover', swallow)
      window.removeEventListener('drop', swallow)
    }
  }, [])

  const load = useCallback(async (file: File) => {
    const { id, label } = deriveRecordingName(file.name)

    setLoadingName(file.name)
    setError(null)

    try {
      const looksLikeJson =
        file.name.toLowerCase().endsWith('.json') || file.type === 'application/json'
      if (!looksLikeJson) {
        throw new Error('Traces reads rrweb JSON. This file is not JSON.')
      }

      /* Checked before `text()`, not after: the point is to not read the bytes at all. */
      if (file.size > MAX_RECORDING_BYTES) {
        throw new Error(
          `${megabytes(file.size)} is over the ${megabytes(MAX_RECORDING_BYTES)} cap for a recording file, ` +
            'so it was not read.',
        )
      }

      const text = await file.text()

      /*
        `JSON.parse`'s own SyntaxError already names the byte offset it gave up at — "Unexpected end of
        JSON input", "Unexpected token } in JSON at position 41822" — which is the single most useful
        sentence available for a truncated file. Replacing it with "invalid JSON" would throw away the
        only part a person can act on, so it is allowed through unwrapped.
      */
      const parsed: unknown = JSON.parse(text)

      // `loadRecordingFile`, not `loadRecording`: a downloaded recording is the `{ id, label, events, … }`
      // wrapper the recorder writes, and a hand-extracted one is a bare array. That adapter accepts both,
      // which is why this path needs no format detection of its own.
      const recording = loadRecordingFile(id, label, parsed)
      const checkpoints = buildCheckpointIndex(recording.events, recording.startedAt)

      sessionActions().loadRecording(recording, checkpoints)
    } catch (cause) {
      // `file.name` rather than the derived id: this names the file that failed, and a person who has to
      // go and look at it on disk needs the name they will actually see in a folder.
      const message = cause instanceof Error ? cause.message : String(cause)
      setError({ id: file.name, message, source: 'file' })
      reportError(`${file.name} did not load`, message)
    } finally {
      setLoadingName(null)
    }
  }, [])

  return { load, loadingName, error }
}
