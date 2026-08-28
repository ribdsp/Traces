'use client'

import { TriangleAlert } from 'lucide-react'
import { SAMPLE_RECORDINGS } from '@/components/ui/sample-recordings'
import { useSampleLoader } from '@/components/ui/use-sample-loader'
import { useSessionStore } from '@/lib/store/session'

/**
 * Loads a sample recording. The only control on the page that has to work before anything else does.
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
 * The fetch itself lives in `useSampleLoader`, shared with the empty state's one-click load.
 *
 * The labels are the file stems rather than prose, deliberately: they are the same ids the agent sees in
 * `read_session_meta`, so a human reading over the agent's shoulder does not have to translate.
 */

export function RecordingPicker() {
  const openId = useSessionStore((s) => s.recording?.id ?? null)
  const { load, loadingId, error } = useSampleLoader()

  return (
    <div className="flex min-w-0 shrink flex-col items-end gap-1">
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
        <span className="mr-1 hidden text-[10px] uppercase tracking-wide text-faint sm:inline">
          recording
        </span>

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
              className={`border px-1.5 py-0.5 font-mono text-[10px] focus-visible:border-ink focus-visible:outline-none disabled:opacity-50 ${
                isOpen
                  ? 'border-faint bg-raised text-ink'
                  : 'border-line text-muted hover:border-faint hover:text-ink'
              }`}
            >
              {sample.id}
              {isLoading ? <span className="ml-1 text-muted">loading…</span> : null}
            </button>
          )
        })}
      </div>

      {/*
        `max-w-full` rather than a fixed measure: at 720px a `36rem` paragraph is wider than the window,
        and the one component whose job is to explain a failure must not become one.
      */}
      {error ? (
        <p
          role="alert"
          className="flex max-w-full items-start justify-end gap-1 text-right text-[10px] leading-snug text-error"
        >
          <TriangleAlert aria-hidden size={12} strokeWidth={1.5} className="mt-px shrink-0" />
          <span>
            <span className="font-mono">{error.id}</span> did not load: {error.message}.{' '}
            <span className="text-error/70">
              Samples live in <span className="font-mono">traces/public/recordings/</span> — record one
              against <span className="font-mono">bugbait</span> if it is not there yet.
            </span>
          </span>
        </p>
      ) : null}
    </div>
  )
}
