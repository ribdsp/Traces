'use client'

import { CirclePlay, FolderOpen, Layers, Plug } from 'lucide-react'
import { useRef } from 'react'
import { reportSuccess } from '@/components/ui/error-toast'
import { SAMPLE_RECORDINGS } from '@/components/ui/sample-recordings'
import { useFileLoader } from '@/components/ui/use-file-loader'
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
 * The recording can now be the reader's own, which is why this panel is also the drop target: someone
 * arriving from the README with a file they just recorded has no reason to guess that the header holds a
 * menu, and the largest empty rectangle on screen is the one they will aim at.
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
  const { load: loadSample, loadingId } = useSampleLoader()
  const { load: loadFile, loadingName } = useFileLoader()

  const fileInputRef = useRef<HTMLInputElement>(null)

  const busy = loadingId !== null || loadingName !== null

  return (
    <div className="max-h-full w-full max-w-xl overflow-y-auto px-4 py-1 text-body leading-relaxed">
      <h2 className="text-title font-semibold tracking-tight text-ink">
        Session replay an AI agent can interrogate
      </h2>
      <p className="mt-1 text-muted">
        Load a session, then ask what went wrong — at the exact millisecond it happened. When the agent
        cannot see, it asks you to look.
      </p>

      <section className="mt-3 rounded-sm border border-line bg-panel/60 px-2.5 py-2">
        <h3 className="flex items-center gap-1.5 font-medium text-ink">
          <Layers aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-muted" />
          This Panel is DOM
        </h3>
        <p className="mt-0.5 text-muted">
          Replaying a recording rebuilds the page as a live document. Every node is really there, and
          queryable, at whichever millisecond the playhead is on. That is why the tools register in this
          browser tab rather than behind an API: nothing on a server holds this DOM.
        </p>
      </section>

      <section className="mt-3">
        <h3 className="flex items-center gap-1.5 font-medium text-ink">
          <CirclePlay aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-muted" />
          Load a recording
        </h3>
        <p className="mt-0.5 text-meta text-faint">
          Three samples, one click each — or a recording of your own.
        </p>

        <ul className="mt-1.5 space-y-1">
          {SAMPLE_RECORDINGS.map((sample) => (
            <li key={sample.id}>
              {/*
                The whole row is the button, not a control beside a description: at 298px a separate
                target would be a 90px word next to three lines of text explaining what it does.
              */}
              <button
                type="button"
                onClick={() => {
                  void loadSample(sample)
                }}
                disabled={busy}
                className="flex w-full items-start gap-2 rounded-sm border border-line-strong bg-raised/40 px-2 py-1.5 text-left hover:border-faint hover:bg-raised/60 focus-visible:border-ink disabled:opacity-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-mono font-medium text-ink">{sample.id}</span>
                  <span className="mt-0.5 block text-label leading-snug text-muted">
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
                </span>
                <CirclePlay
                  aria-hidden
                  size={16}
                  strokeWidth={1.75}
                  className="mt-0.5 shrink-0 text-faint"
                />
              </button>
            </li>
          ))}

          {/*
            Same row shape as the three above, prose title instead of a monospace stem so it does not
            read as a fourth sample. The border change while a file is over the panel is not the whole
            signal — the second line changes with it, because a dashed outline is a colour-and-shape cue
            and one of those is not a state.
          */}
          <li>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="flex w-full items-start gap-2 rounded-sm border border-line-strong bg-raised/40 px-2 py-1.5 text-left hover:border-faint hover:bg-raised/60 focus-visible:border-ink disabled:opacity-50"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-ink">Load a file…</span>
                <span className="mt-0.5 block text-label leading-snug text-muted">
                  {loadingName !== null ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" />
                      loading…
                    </span>
                  ) : (
                    'An rrweb recording from your own app, read in this tab and never uploaded — there is no server to upload it to. Drop a JSON file anywhere on this panel.'
                  )}
                </span>
              </span>
              <FolderOpen
                aria-hidden
                size={16}
                strokeWidth={1.75}
                className="mt-0.5 shrink-0 text-faint"
              />
            </button>
          </li>
        </ul>

        {/* Reset before loading so the same file can be chosen twice running; see the picker's copy of
            this, which explains what the second silent pick would otherwise look like. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void loadFile(file)
          }}
        />

      </section>

      <section className="mt-3">
        <h3 className="flex items-center gap-1.5 font-medium text-ink">
          <Plug aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-muted" />
          Getting WebMCP
        </h3>
        <p className="mt-1 text-meta leading-relaxed text-muted">
          WebMCP is how an agent finds the seventeen tools on this page. Turn it on in ChatGPT Desktop or
          Chrome, then the header pill should read live. Replay still works without it — only the agent
          needs the tools.
        </p>
        <ul className="mt-1.5 space-y-1.5">
          <li className="rounded-sm border border-line bg-panel/60 px-2.5 py-2">
            <p className="flex items-center gap-1.5 font-medium text-ink">
              <img src="/image/ChatGPT.webp" alt="" width={20} height={20} draggable={false} onDragStart={(event) => event.preventDefault()} className="shrink-0 brightness-0 invert" />
              ChatGPT Desktop
            </p>
            <p className="mt-1 text-meta leading-relaxed text-muted">
              Open this page in the in-app browser, then turn site tools on:
            </p>
            <p className="mt-1 font-mono text-label leading-relaxed text-ink">
              Settings → Browser → Permissions → Enable site tools
            </p>
          </li>
          <li className="rounded-sm border border-line bg-panel/60 px-2.5 py-2">
            <p className="flex items-center gap-1.5 font-medium text-ink">
              <img src="/image/Chrome.webp" alt="" width={20} height={20} draggable={false} onDragStart={(event) => event.preventDefault()} className="shrink-0" />
              Chrome 149+
            </p>
            <p className="mt-1 text-meta leading-relaxed text-muted">
              Turn on{' '}
              <CopyFlag />
              , then reload.
            </p>
          </li>
        </ul>
      </section>
    </div>
  )
}

const CHROME_FLAG = 'chrome://flags/#enable-webmcp-testing'

function CopyFlag() {
  return (
    <button
      type="button"
      title="Click to copy"
      onClick={() => {
        if (typeof navigator.clipboard === 'undefined') {
          reportSuccess('Copy this flag', CHROME_FLAG)
          return
        }
        void navigator.clipboard.writeText(CHROME_FLAG).then(
          () => reportSuccess('Copied', CHROME_FLAG),
          () => reportSuccess('Copy this flag', CHROME_FLAG),
        )
      }}
      className="rounded-sm font-mono text-ink underline decoration-dotted hover:decoration-solid"
    >
      {CHROME_FLAG}
    </button>
  )
}
