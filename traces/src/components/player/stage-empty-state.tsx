'use client'

import { CirclePlay, Layers, Plug, TriangleAlert } from 'lucide-react'
import { SAMPLE_RECORDINGS } from '@/components/ui/sample-recordings'
import { useSampleLoader } from '@/components/ui/use-sample-loader'

/**
 * What the stage says before a recording is loaded, which is the first thing anyone sees.
 *
 * It replaced "No recording loaded." — true, and it taught nobody anything. Four things have to fit here,
 * because this is the only moment a reader will accept being told any of them:
 *
 *   1. what Traces is, in one line;
 *   2. that this panel becomes a *DOM*, not a video — which is the fact the whole product rests on, and
 *      the reason the tool surface has to attach to a page in a browser rather than to an HTTP API. A
 *      judge who reads "session replay" and pictures a video file has already misunderstood the demo;
 *   3. how to get WebMCP at all, since on a browser without it nothing below is callable;
 *   4. a recording, in one click. Prose that ends without an action gets read once and then closed.
 *
 * It also holds the long description that used to truncate in the header, and that is the right home for
 * it: it is onboarding, so it is wanted exactly when there is no recording and in the way once there is.
 * The header keeps a short standing subtitle — see `page.tsx`.
 *
 * Two layout constraints, both load-bearing. The stage frame is `overflow-hidden` and centres its child,
 * so anything too tall here is *clipped* rather than scrolled — hence `max-h-full overflow-y-auto`, which
 * is the internal scroll the page frame is allowed to have. And the panel is narrower than it looks: the
 * agent column is a fixed 380px and does not shrink, so at a 720px window this text gets 298px, measured.
 * That is the width the copy and the wrapping sample rows are written for, not the 340-odd the panel
 * reports.
 */
export function StageEmptyState() {
  const { load, loadingId, error } = useSampleLoader()

  return (
    <div className="max-h-full w-full max-w-xl overflow-y-auto px-4 py-1 text-meta leading-relaxed">
      <h2 className="text-title font-semibold tracking-tight text-ink">
        Session replay an AI agent can interrogate
      </h2>
      <p className="mt-1 text-muted">
        It reads the DOM at any moment, binary-searches the timeline for where the page went wrong, and
        asks you to look when it cannot see.
      </p>

      <section className="mt-3 border-l border-line pl-2.5">
        <h3 className="flex items-center gap-1.5 font-medium text-ink">
          <Layers aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-muted" />
          This panel is a DOM, not a video
        </h3>
        <p className="mt-0.5 text-muted">
          A recording is a stream of mutation events, and replaying it rebuilds the page as a live
          document — so every node is really present and really queryable at whichever millisecond the
          playhead is on. That is why the tools register on a page in your browser rather than behind an
          API: nothing on a server holds this DOM.
        </p>
      </section>

      <section className="mt-3">
        <h3 className="flex items-center gap-1.5 font-medium text-ink">
          <CirclePlay aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-muted" />
          Load a recording
        </h3>

        <ul className="mt-1.5 space-y-1">
          {SAMPLE_RECORDINGS.map((sample) => (
            <li key={sample.id}>
              {/*
                The whole row is the button, not a control beside a description: at 298px a separate
                target would be a 90px word next to three lines of text explaining what it does.
              */}
              <button
                type="button"
                onClick={() => load(sample)}
                disabled={loadingId !== null}
                className="flex w-full flex-col items-start gap-y-0.5 rounded-sm border border-line-strong px-2 py-1 text-left hover:border-faint hover:bg-raised/60 focus-visible:border-ink disabled:opacity-50 sm:flex-row sm:items-baseline sm:gap-x-2"
              >
                <span className="shrink-0 font-mono font-medium text-ink">{sample.id}</span>
                <span className="text-label leading-snug text-muted">
                  {sample.id === loadingId ? (
                    /*
                      The same dot the header's picker shows, for the same reason: this is the one wait in
                      the app the human did not choose to sit through. It settles solid under reduced
                      motion, and "loading…" is what carries the state in either case.
                    */
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" />
                      loading…
                    </span>
                  ) : (
                    sample.blurb
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {error ? (
          <p role="alert" className="mt-1.5 flex items-start gap-1 text-label text-error">
            <TriangleAlert aria-hidden size={14} strokeWidth={1.75} className="mt-px shrink-0" />
            <span>
              <span className="font-mono">{error.id}</span> did not load: {error.message}. Samples live in{' '}
              <span className="font-mono">traces/public/recordings/</span>.
            </span>
          </p>
        ) : null}
      </section>

      <section className="mt-3">
        <h3 className="flex items-center gap-1.5 font-medium text-ink">
          <Plug aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-muted" />
          Getting WebMCP
        </h3>
        <ul className="mt-1 space-y-0.5 text-muted">
          <li>
            <span className="text-ink">ChatGPT desktop</span>, in its in-app browser — works as it
            comes.
          </li>
          <li>
            <span className="text-ink">Chrome 149+</span> — turn on{' '}
            <code className="text-ink">chrome://flags/#enable-webmcp-testing</code>, then reload.
          </li>
        </ul>
        <p className="mt-1 text-faint">
          The bar at the top of the window says which of those you are on, and whether the sixteen tools
          registered. Everything below works without WebMCP; only the agent needs it.
        </p>
      </section>
    </div>
  )
}
