'use client'

import { useState } from 'react'
import {
  SAMPLE_RECORDINGS,
  sampleRecordingUrl,
  type SampleRecording,
} from '@/components/ui/sample-recordings'
import { buildCheckpointIndex } from '@/lib/replay/checkpoint-index'
import { loadRecording as parseRecording } from '@/lib/replay/load-recording'
import { sessionActions, useSessionStore } from '@/lib/store/session'

/**
 * Loads a sample recording. The only control on the page that has to work before anything else does.
 *
 * Owner: Faiq.
 *
 * All three states are real here, and none of them is theoretical:
 *
 *   loading — a recording is a few hundred KB of JSON. Say which one is coming.
 *   error   — `public/recordings/` may be empty, the JSON may be malformed, or the parse may reject it.
 *             All three are ordinary, and all three have to name the file and the reason. A picker that
 *             silently does nothing on click is the single worst thing this component could do, because
 *             the next person debugs the player instead of the missing file.
 *   loaded  — the button for the open recording is marked, so the header answers "which one is this".
 *
 * The labels are the file stems rather than prose, deliberately: they are the same ids the agent sees in
 * `read_session_meta`, so a human reading over the agent's shoulder does not have to translate.
 */

type PickerError = { id: string; message: string }

export function RecordingPicker() {
  const openId = useSessionStore((s) => s.recording?.id ?? null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [error, setError] = useState<PickerError | null>(null)

  async function load(sample: SampleRecording) {
    const url = sampleRecordingUrl(sample.id)

    setLoadingId(sample.id)
    setError(null)

    try {
      const response = await fetch(url, { cache: 'no-store' })

      /** `fetch` resolves on 404, so a missing sample arrives here as a perfectly happy promise. */
      if (!response.ok) {
        throw new Error(`${url} — HTTP ${response.status} ${response.statusText}`.trim())
      }

      const raw: unknown = await response.json()
      const recording = parseRecording(sample.id, sample.label, raw)
      const checkpoints = buildCheckpointIndex(recording.events, recording.startedAt)

      sessionActions().loadRecording(recording, checkpoints)
    } catch (cause) {
      setError({ id: sample.id, message: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <span className="mr-1 text-[10px] uppercase tracking-wide text-zinc-600">recording</span>

        {SAMPLE_RECORDINGS.map((sample) => {
          const isOpen = sample.id === openId
          const isLoading = sample.id === loadingId

          return (
            <button
              key={sample.id}
              type="button"
              onClick={() => load(sample)}
              disabled={loadingId !== null}
              title={`${sample.label} — ${sample.blurb}`}
              aria-current={isOpen ? 'true' : undefined}
              className={`border px-1.5 py-0.5 font-mono text-[10px] disabled:opacity-50 ${
                isOpen
                  ? 'border-zinc-500 bg-zinc-800 text-zinc-100'
                  : 'border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
              }`}
            >
              {sample.id}
              {isLoading ? <span className="ml-1 text-zinc-500">loading…</span> : null}
            </button>
          )
        })}
      </div>

      {error ? (
        <p
          role="alert"
          className="max-w-[36rem] text-right text-[10px] leading-snug text-rose-300"
        >
          <span className="font-mono">{error.id}</span> did not load: {error.message}.{' '}
          <span className="text-rose-400/70">
            Samples live in <span className="font-mono">traces/public/recordings/</span> — record one
            against <span className="font-mono">bugbait</span> if it is not there yet.
          </span>
        </p>
      ) : null}
    </div>
  )
}
