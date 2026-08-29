'use client'

import { Check, ChevronDown, ChevronUp, FolderOpen, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { SAMPLE_RECORDINGS, type SampleRecording } from '@/components/ui/sample-recordings'
import { formatSeconds } from '@/components/ui/format-time'
import { useFileLoader } from '@/components/ui/use-file-loader'
import { useSampleLoader } from '@/components/ui/use-sample-loader'
import { useSessionStore } from '@/lib/store/session'

/**
 * Loads a recording — one of the three samples, or a file off the reader's own disk. The only control on
 * the page that has to work before anything else does.
 *
 * All three states are real here, and none of them is theoretical:
 *
 *   loading — a recording is a few hundred KB of JSON. Say which one is coming.
 *   error   — `public/recordings/` may be empty, the JSON may be malformed, or the parse may reject it.
 *             All three are ordinary, and all three have to name the file and the reason. A picker that
 *             silently does nothing on click is the single worst thing this component could do, because
 *             the next person debugs the player instead of the missing file.
 *   loaded  — the trigger *is* the answer to "which one is this", so the header stops needing a legend.
 *
 * Neither load lives here: `useSampleLoader` fetches a sample, `useFileLoader` reads a chosen file, and
 * both are shared with the empty state, which offers the same two things to a reader who has not found
 * the header yet.
 *
 * The labels are the file stems rather than prose, deliberately: they are the same ids the agent sees in
 * `read_session_meta`, so a human reading over the agent's shoulder does not have to translate. A loaded
 * file gets the same treatment — its id is derived from its name, and the trigger shows that id.
 *
 * Why a dropdown rather than the three bare buttons this used to be: three toggles of equal weight said
 * nothing about which was open, cost the width of all three ids in a header that has to survive 720px,
 * and had nowhere to put the one thing a first-time viewer needs — *what the bug is*. A trigger plus a
 * panel puts the open recording's id in the header and each sample's blurb where it can be read.
 *
 * Written by hand against the listbox pattern rather than pulled from a UI library, because a headless
 * dropdown is roughly this much code once and a dependency forever. What the pattern requires, and what
 * is therefore not optional here: `aria-expanded` on the trigger, `role="listbox"` on the panel with
 * `role="option"` and `aria-selected` on each row, arrows to move, Enter to choose, and Escape to close
 * *and hand focus back to the trigger* — a dropdown that closes and drops the keyboard on the body is a
 * dropdown a keyboard user cannot get out of without a mouse.
 *
 * Duration and event count are shown for the open recording only. They are not in `SAMPLE_RECORDINGS`,
 * which is a static three-line manifest, and they cannot be without either fetching every sample at
 * mount to measure it or hardcoding numbers that go stale the next time a sample is re-recorded.
 */

/** `aria-activedescendant` needs a stable id per row, and the panel needs to scroll one into view. */
function optionId(id: string): string {
  return `recording-option-${id}`
}

/**
 * The file row's key, in the same namespace as the sample stems because `optionId` hands both to one
 * `document.getElementById`. That it collides with none of them is checkable by reading
 * `sample-recordings.ts`, which is three entries long.
 */
const FILE_ROW_KEY = 'load-a-file'

type Row =
  | { readonly kind: 'sample'; readonly key: string; readonly sample: SampleRecording }
  | { readonly kind: 'file'; readonly key: string }

/**
 * Every row in the listbox, in order, and the only thing that knows how many there are.
 *
 * One array rather than "the samples, and also the file one": `activeIndex`, `aria-activedescendant`,
 * the scroll-into-view effect and the arrow-key bounds are four things that must agree about what row 3
 * is, and they agreed only by coincidence when each indexed `SAMPLE_RECORDINGS` separately. An index
 * that runs one past that array does not throw under `noUncheckedIndexedAccess`; it yields `undefined`,
 * and the visible symptom is `aria-activedescendant` pointing at an element that does not exist, which
 * nothing on screen shows and only a screen reader reports.
 *
 * **The file row is an option inside the list, not a control after it, and that is load-bearing.** This
 * panel's key handler closes on `Tab` — see `onListKeyDown` — so a button placed after the `<ul>` could
 * never be reached by keyboard: the keystroke meant to move onto it unmounts it first. Anything the
 * panel offers has to be a row.
 *
 * Module scope because it is genuinely constant: `SAMPLE_RECORDINGS` is a module constant too, so
 * rebuilding this per render would only give the effects below a new dependency identity every time.
 */
const ROWS: readonly Row[] = [
  ...SAMPLE_RECORDINGS.map((sample): Row => ({ kind: 'sample', key: sample.id, sample })),
  { kind: 'file', key: FILE_ROW_KEY },
]

const LAST_ROW = ROWS.length - 1

export function RecordingPicker() {
  const recording = useSessionStore((s) => s.recording)
  const { load: loadSample, loadingId, error: sampleError } = useSampleLoader()
  const { load: loadFile, loadingName, error: fileError } = useFileLoader()

  const [open, setOpen] = useState(false)
  /** Which row the arrows are on. Separate from the selection: moving is not choosing. */
  const [activeIndex, setActiveIndex] = useState(0)
  /**
   * Which of the two loaders was asked last, so the alert shows that one's failure and not the other's.
   *
   * Each hook clears its own error when it starts, which is all a hook can do and not enough for a
   * component holding two of them: a file that failed, followed by a sample that loaded fine, would
   * otherwise leave the file's alert on screen beside a recording that is open and working. An alert
   * that outlives its failure is worse than no alert, because the next thing the reader distrusts is the
   * recording.
   */
  const [lastAttempt, setLastAttempt] = useState<'sample' | 'file' | null>(null)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const openId = recording?.id ?? null
  /**
   * -1 once a file is loaded, since its derived id is in no sample's row, and the tick correctly goes
   * nowhere. A file named after a sample is the one case that ticks a sample row, which is not a lie:
   * the recording's id *is* that string, and it is the string the trigger and `read_session_meta` show.
   */
  const openIndex = ROWS.findIndex((row) => row.kind === 'sample' && row.sample.id === openId)

  /** Opening lands on the current recording, or the top of the list when nothing is loaded yet. */
  const show = () => {
    setActiveIndex(openIndex === -1 ? 0 : openIndex)
    setOpen(true)
  }

  const hide = (returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }

  const choose = (row: Row) => {
    hide(true)

    if (row.kind === 'file') {
      /* Opening the picker is the whole action; the load starts in the input's `change`, whenever the
         person gets round to it. Closing first is deliberate — the native dialog is modal, and a panel
         left open behind it is still there on cancel. */
      fileInputRef.current?.click()
      return
    }

    setLastAttempt('sample')
    void loadSample(row.sample)
  }

  /* Focus the panel itself and drive it with `aria-activedescendant`, rather than moving DOM focus
     through the options — one focus target means Escape always has somewhere to return from. */
  useEffect(() => {
    if (open) listRef.current?.focus()
  }, [open])

  /** A click anywhere else closes it, and deliberately does *not* pull focus back to the trigger. */
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      const wrap = wrapRef.current
      if (wrap && event.target instanceof Node && !wrap.contains(event.target)) setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  /** Keep the arrow-selected row visible in a panel that scrolls at narrow heights. */
  useEffect(() => {
    if (!open) return
    const key = ROWS[activeIndex]?.key
    if (key) document.getElementById(optionId(key))?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  const onListKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActiveIndex((index) => (index >= LAST_ROW ? 0 : index + 1))
        return
      case 'ArrowUp':
        event.preventDefault()
        setActiveIndex((index) => (index <= 0 ? LAST_ROW : index - 1))
        return
      case 'Home':
        event.preventDefault()
        setActiveIndex(0)
        return
      case 'End':
        event.preventDefault()
        setActiveIndex(LAST_ROW)
        return
      case 'Enter':
      case ' ': {
        event.preventDefault()
        // `noUncheckedIndexedAccess`: `activeIndex` is only ever set from this list's own bounds, but
        // the compiler cannot know that and a silent no-op is the right answer if it is ever wrong.
        const row = ROWS[activeIndex]
        if (row) choose(row)
        return
      }
      case 'Escape':
        event.preventDefault()
        hide(true)
        return
      case 'Tab':
        // Let focus leave normally, but do not leave an orphaned panel open behind it. This is the line
        // the file row has to be inside the list to survive — see the note on `ROWS`.
        setOpen(false)
        return
      default:
        return
    }
  }

  const activeKey = ROWS[activeIndex]?.key
  const loading = loadingId !== null || loadingName !== null
  /* `lastAttempt` is null only before either loader has run, when `sampleError` is null as well. */
  const error = lastAttempt === 'file' ? fileError : sampleError

  return (
    <div ref={wrapRef} className="relative flex min-w-0 shrink flex-col items-end">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={
          openId ? `Recording: ${openId}. Choose another.` : 'Choose a recording to load'
        }
        title="Which recorded session the player and the agent are both looking at."
        onClick={() => (open ? hide(false) : show())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            show()
          }
        }}
        className="flex min-w-0 max-w-[14rem] items-center gap-1.5 rounded-sm border border-line-strong bg-raised px-1.5 py-0.5 shadow-raised hover:border-faint"
      >
        <span className="text-label uppercase tracking-wide text-faint">rec</span>
        {/* A file in flight shows by name rather than by derived id: the name is what the person just
            picked out of a folder, and until it parses there is nothing else honest to call it. */}
        <span className="min-w-0 truncate font-mono text-meta text-ink">
          {loadingId ?? loadingName ?? openId ?? 'none loaded'}
        </span>
        {loading ? (
          /*
            The one place a person waits on us rather than the other way round, so it gets the same dot
            vocabulary as the gate in `ask-human-visual-prompt.tsx` — `muted` instead of `warn`, because
            here the machine is the one working. The word stays: under `prefers-reduced-motion` the dot
            settles solid and "loading…" is what still says what is happening.
          */
          <span className="flex shrink-0 items-center gap-1.5 text-label text-muted">
            <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" />
            loading…
          </span>
        ) : /* Two glyphs rather than one rotated: reduced motion zeroes the transform and would leave
              the open state signalled by nothing. Same reasoning as `webmcp-badge.tsx`. */
        open ? (
          <ChevronUp aria-hidden size={13} strokeWidth={1.75} className="shrink-0 text-muted" />
        ) : (
          <ChevronDown aria-hidden size={13} strokeWidth={1.75} className="shrink-0 text-muted" />
        )}
      </button>

      {/*
        Outside the panel's conditional on purpose. `choose` closes the panel and clicks this in the same
        breath, and the `change` event arrives long after — as late as the person takes to find the file.
        Rendered inside the `<ul>` it would be unmounted before either happened, and the chosen file
        would go nowhere with nothing on screen to say so.

        `hidden` rather than a styled control: a native file input cannot be restyled to match anything,
        and the row above is already the label, the target and the keyboard route. Programmatic `.click()`
        on a `display: none` input opens the dialog in every browser this app runs in.
      */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          /* Cleared before the load, so choosing the same file twice fires `change` twice. Left set, a
             second identical pick is silently nothing — the exact failure this component is written to
             never have. */
          event.target.value = ''
          if (!file) return
          setLastAttempt('file')
          void loadFile(file)
        }}
      />

      {open ? (
        <ul
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          aria-label="Recordings"
          /* Omitted rather than pointed at `recording-option-`, in the case the compiler insists is
             possible: an attribute naming no element is a worse answer than no attribute. */
          aria-activedescendant={activeKey ? optionId(activeKey) : undefined}
          onKeyDown={onListKeyDown}
          /* `raised` and a lighter border rather than a drop shadow — see the elevation note in
             CONTRIBUTING.md. `z-30` clears the docked WebMCP badge, which sits at 20. The panel keeps the
             global focus outline: it is the element that actually holds focus while open — options are
             driven by `aria-activedescendant`, not by moving focus — so suppressing it would leave a
             keyboard user with no indication of where they are, and the row highlight cannot stand in for
             one because `onMouseEnter` sets it too. */
          className="absolute right-0 top-[calc(100%+4px)] z-30 max-h-[60vh] w-[24rem] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-md border border-line-strong bg-raised p-1 shadow-raised"
        >
          {ROWS.map((row, index) => {
            const isActive = index === activeIndex

            if (row.kind === 'file') {
              return (
                <li
                  key={row.key}
                  id={optionId(row.key)}
                  role="option"
                  /* Never true. There is no state of this app in which "load a file" is the thing
                     currently open, so it is an action wearing a row, and the tick column stays empty
                     for it even while it is the active row. */
                  aria-selected={false}
                  onClick={() => choose(row)}
                  onMouseEnter={() => setActiveIndex(index)}
                  /* A rule above it, and prose instead of a monospace stem, so four rows do not read as
                     four samples. Padding written out rather than `py-1.5` plus an override, so the
                     extra room above the rule does not depend on which utility Tailwind emits last. */
                  className={`mt-1 cursor-pointer rounded-sm border-t border-line px-2 pb-1.5 pt-2 ${
                    isActive ? 'bg-panel' : ''
                  }`}
                >
                  <p className="flex items-baseline gap-1.5">
                    <FolderOpen
                      aria-hidden
                      size={14}
                      strokeWidth={1.75}
                      className="shrink-0 text-muted"
                    />
                    <span className="min-w-0 truncate text-body text-ink">Load a file…</span>
                  </p>
                  <p className="mt-0.5 pl-[1.25rem] text-meta leading-snug text-muted">
                    An rrweb JSON file from your own app. Nothing is uploaded.
                  </p>
                </li>
              )
            }

            const { sample } = row
            const isOpen = sample.id === openId

            return (
              <li
                key={row.key}
                id={optionId(row.key)}
                role="option"
                aria-selected={isOpen}
                onClick={() => choose(row)}
                onMouseEnter={() => setActiveIndex(index)}
                className={`cursor-pointer rounded-sm px-2 py-1.5 ${
                  isActive ? 'bg-panel' : ''
                }`}
              >
                <p className="flex items-baseline gap-1.5">
                  {isOpen ? (
                    <Check aria-hidden size={14} strokeWidth={2} className="shrink-0 text-ok" />
                  ) : (
                    /* Holds the tick's column so the ids line up whether or not one is open. Its width and
                       the indent below are the icon's 14px plus the 6px `gap-1.5`. */
                    <span aria-hidden className="w-3.5 shrink-0" />
                  )}
                  <span
                    className={`min-w-0 truncate font-mono text-body ${isOpen ? 'text-ink' : 'text-muted'}`}
                  >
                    {sample.id}
                  </span>
                  {isOpen ? (
                    <span className="ml-auto shrink-0 text-label uppercase tracking-wide text-ok">
                      open
                    </span>
                  ) : null}
                </p>

                <p className="mt-0.5 pl-[1.25rem] text-meta leading-snug text-muted">
                  {sample.blurb}
                </p>

                {/* Only the loaded recording can say how long it is — see the note at the top. The
                    count comes from `meta.eventCount`, which is the number `read_session_meta` hands
                    the agent, so a human comparing the two is comparing the same figure. */}
                {isOpen && recording ? (
                  <p className="mt-1 flex items-center gap-1.5 pl-[1.25rem] font-mono text-label tabular-nums text-faint">
                    <span>{formatSeconds(recording.durationMs)}</span>
                    <span aria-hidden>·</span>
                    <span>{recording.meta.eventCount} events</span>
                    <span aria-hidden>·</span>
                    <span>
                      {recording.meta.viewport.width}×{recording.meta.viewport.height}
                    </span>
                  </p>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}

      {/*
        `max-w-full` rather than a fixed measure: at 720px a `36rem` paragraph is wider than the window,
        and the one component whose job is to explain a failure must not become one. Absolutely
        positioned, because the header is `shrink-0` and a wrapping error message that grew it would take
        the height out of the replay panel — the frame must not move because a fetch failed.
      */}
      {error ? (
        <p
          role="alert"
          className="absolute right-0 top-[calc(100%+4px)] z-20 flex w-[24rem] max-w-[calc(100vw-1.5rem)] items-start gap-1.5 rounded-md border border-error/50 bg-error/10 px-2 py-1.5 text-meta leading-snug text-error"
        >
          <TriangleAlert aria-hidden size={14} strokeWidth={1.75} className="mt-px shrink-0" />
          <span>
            {/* The period is conditional because the two sources punctuate differently and both are
                quoted verbatim: `loadRecording` throws whole sentences ending in one, while a
                `SyntaxError` and an HTTP status do not. Appending unconditionally gave "no events..",
                and not appending ran the reason straight into the hint. */}
            <span className="font-mono">{error.id}</span> did not load: {error.message}
            {error.message.endsWith('.') ? '' : '.'}{' '}
            {/* The hint has to branch. Sending someone to `traces/public/recordings/` is the right next
                step for a sample that is not there, and nonsense for a file they picked off their own
                disk — it tells them to look for their file inside this repository. */}
            <span className="text-error/70">
              {error.source === 'sample' ? (
                <>
                  Samples live in <span className="font-mono">traces/public/recordings/</span> — record
                  one against <span className="font-mono">bugbait</span> if it is not there yet.
                </>
              ) : (
                <>
                  Traces reads rrweb JSON: the event array{' '}
                  <span className="font-mono">record</span> collects, or the{' '}
                  <span className="font-mono">{'{ events: … }'}</span> wrapper a downloaded recording
                  has.
                </>
              )}
            </span>
          </span>
        </p>
      ) : null}
    </div>
  )
}
