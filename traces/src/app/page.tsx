'use client'

import { Keyboard } from 'lucide-react'
import { useEffect } from 'react'
import { AgentLane, AGENT_LANE_INPUT_ID } from '@/components/agent/agent-lane'
import { ActivityFeed } from '@/components/agent/activity-feed'
import { AskHumanVisualPrompt } from '@/components/agent/ask-human-visual-prompt'
import { HypothesisCards } from '@/components/agent/hypothesis-cards'
import { ReportDraft } from '@/components/agent/report-draft'
import { PlayerControls, SCRUBBER_ID } from '@/components/player/player-controls'
import { ReplayStage } from '@/components/player/replay-stage'
import { Timeline } from '@/components/timeline/timeline'
import { RecordingPicker } from '@/components/ui/recording-picker'
import { ResizableSplit } from '@/components/ui/resizable-split'
import { TOOL_STATUS_SLOT_ID } from '@/components/ui/tool-status-banner'

/**
 * The whole app, on one screen.
 *
 * Two panels, and the split says what the product is: the replay on the left is what the human is
 * looking at, the agent's work on the right is what the agent is doing, and the timeline underneath
 * belongs to both of them. Nothing here is behind a tab. A viewer should be able to watch an agent
 * work and a human respond without anyone clicking to a different view to explain it.
 *
 * No scrolling at the top level. Recorded at 1280×720 for the demo video, and a page that scrolls
 * during a screen recording is a page where the important part is off-frame half the time. The height
 * comes from flexing against the layout rather than from subtracting the banner's height, because that
 * banner is one line when healthy and several when it has something to report.
 *
 * The frame is what must not scroll — a *panel* may, and two do: the agent column, and the empty state on
 * the stage. That distinction matters more than the 1280×720 the rule was written for, because this is
 * also judged in the ChatGPT desktop in-app browser, whose window is whatever width the user left it.
 * Verified at 720, 900, 1100 and 1440.
 *
 * MarkPointOverlay is no longer mounted here: it belongs to the stage it dims, and mounting it in both
 * places would have rendered the question twice the day `pendingAsk` first got set.
 *
 * What shipped, and why:
 *   - `a` focuses the agent lane and `p` focuses the scrubber, which are the two things a hand reaches for
 *     during the demo: hand the agent a task, then drive the replay. Both are a long mouse trip apart on a
 *     1280px screen, and the panel between them is where the interesting output appears.
 *   - `esc` releases focus from whatever is being typed in, which is the shortcut that makes the other two
 *     safe to use. Space plays only while nothing has the keyboard, so without a way back out, the first
 *     `a` costs the player its controls until someone clicks the stage.
 *   - the keys are listed in the header rather than hidden in a help dialog, because a shortcut nobody is
 *     told about is one nobody presses. Below `lg` there is no room to list five of them, so they collapse
 *     into a disclosure rather than disappearing — see `ShortcutLegend`.
 */

/** Bound below and listed in the header, so the legend cannot drift from what is actually handled. */
const FOCUS_KEYS = { agent: 'a', player: 'p' } as const

/**
 * Space and the arrows belong to `PlayerControls` — they are listed here because the legend is about the
 * keyboard, not about which component owns which key.
 */
const LEGEND = [
  { keys: 'space', does: 'play' },
  { keys: '←→', does: 'step' },
  { keys: FOCUS_KEYS.agent, does: 'agent lane' },
  { keys: FOCUS_KEYS.player, does: 'player' },
  { keys: 'esc', does: 'release' },
] as const

/** Shared by both renderings of the legend, so the prose and the disclosure cannot disagree. */
const LEGEND_TITLE =
  'Keyboard: space plays and pauses, the arrows step 100ms (hold shift for a second), a focuses the agent lane, p focuses the scrubber, and escape hands the keyboard back to the player.'

/**
 * Whether a keystroke is part of something being written.
 *
 * Narrower than the equivalent in `PlayerControls`, and deliberately: that one also excludes buttons and
 * links, because the browser already maps space onto them. These shortcuts are letters, which no focused
 * button consumes — so a hand on the timeline's markers can still reach for the agent lane.
 */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  // The report's title and summary are text inputs; the scrubber is an input that holds no text.
  if (target instanceof HTMLInputElement) return target.type !== 'range'
  return target.tagName === 'TEXTAREA'
}

export default function Home() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === 'Escape') {
        const active = document.activeElement
        if (!(active instanceof HTMLElement) || !isTextEntry(active)) return
        event.preventDefault()
        active.blur()
        return
      }

      if (isTextEntry(event.target)) return

      const id =
        event.key === FOCUS_KEYS.agent
          ? AGENT_LANE_INPUT_ID
          : event.key === FOCUS_KEYS.player
            ? SCRUBBER_ID
            : null
      if (id === null) return

      // By id rather than by ref: both targets live inside components the split renders, and a ref threaded
      // through the layout would make this page's structure a dependency of two unrelated files.
      const target = document.getElementById(id)
      if (target === null) return

      event.preventDefault()
      // Focusing scrolls it into view, which matters for the lane — the agent panel scrolls independently.
      target.focus()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="relative flex shrink-0 items-center justify-between gap-3 border-b border-line bg-panel px-3 py-2">
        <div className="flex min-w-0 items-baseline gap-2">
          {/*
            The wordmark is the one place in this app allowed to be a size larger than its neighbours.
            It is not decoration: a screen recording that opens on a grey instrument with no name on it
            is a recording nobody can attribute afterwards.
          */}
          <h1 className="shrink-0 text-title font-semibold tracking-tight text-ink">Traces</h1>
          <span aria-hidden className="hidden h-3 w-px shrink-0 self-center bg-line-strong md:block" />
          {/*
            Short enough to sit at 900px without truncating, and hidden below `md` rather than clipped.
            The sentence that used to be here — the one that explained what interrogating a replay means —
            moved to `StageEmptyState`, where it has room and where it is actually wanted. `truncate` stays
            as a guard so a future edit to this string cannot push the picker off the right edge.
          */}
          <p className="hidden truncate text-meta text-muted md:block">
            agent-interrogable session replay
          </p>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          {/*
            Where the WebMCP status pill lands. `ToolStatusBanner` owns the element's name and portals
            into it, because registration is held by `ToolSurface` in the root layout — a sibling of this
            page rather than a parent. `display: contents` so the wrapper generates no box: an empty slot
            must not leave a gap in the header before the first render, and once filled the pill should be
            a flex item of this row rather than a child of a spacer.
          */}
          <div id={TOOL_STATUS_SLOT_ID} className="contents" />
          <RecordingPicker />
          <ShortcutLegend />
        </div>
      </header>

      <ResizableSplit
        leftLabel="Replay"
        rightLabel="Agent"
        left={
          <>
            <div className="relative min-h-0 flex-1">
              <ReplayStage />
            </div>
            <PlayerControls />
          </>
        }
        right={
          <>
            <AskHumanVisualPrompt />
            <AgentLane />
            <HypothesisCards />
            <ReportDraft />
            <ActivityFeed />
          </>
        }
      />

      <Timeline />
    </main>
  )
}

/**
 * The keys, in the header.
 *
 * Two renderings of one `LEGEND`, because the narrow case is the common case: this is judged in the
 * ChatGPT desktop in-app browser, which is a window of arbitrary width, and the legend used to be
 * `hidden lg:flex` — so on the screen it most needed to teach, it taught nothing at all. Below `lg` it
 * collapses to a disclosure instead of vanishing.
 *
 * `<details>` rather than a button with state: it is keyboard-reachable and toggleable with no JavaScript
 * and no focus management, and the panel is absolutely positioned so opening it cannot push the layout —
 * which is the one thing this page must not do.
 */
function ShortcutLegend() {
  return (
    <>
      <ul
        title={LEGEND_TITLE}
        className="hidden shrink-0 items-center gap-2 text-label text-faint lg:flex"
      >
        {LEGEND.map((item) => (
          <li key={item.keys} className="flex items-center gap-1">
            <LegendKey keys={item.keys} />
            <span>{item.does}</span>
          </li>
        ))}
      </ul>

      <details className="relative shrink-0 lg:hidden">
        <summary
          title={LEGEND_TITLE}
          className="flex cursor-pointer list-none items-center gap-1 rounded-sm border border-line-strong bg-raised px-1.5 py-0.5 text-label text-muted shadow-raised marker:content-none hover:border-faint hover:text-ink [&::-webkit-details-marker]:hidden"
        >
          {/*
            Names the control rather than decorating a heading: collapsed, this is one word in a crowded
            header, and the glyph is what makes it findable at a glance. The word beside it is still the
            accessible name, so the icon stays hidden from assistive tech.
          */}
          <Keyboard aria-hidden size={13} strokeWidth={1.75} />
          keys
        </summary>

        {/*
          `raised` rather than a heavier border to lift the popover off the header. Drop shadows are out,
          so elevation here is carried by the surface token that exists for it.
        */}
        <ul className="absolute right-0 top-[calc(100%+4px)] z-20 w-max space-y-1 rounded-md border border-line-strong bg-raised px-2 py-1.5 text-label text-muted shadow-raised">
          {LEGEND.map((item) => (
            <li key={item.keys} className="flex items-center gap-1.5">
              <LegendKey keys={item.keys} />
              <span>{item.does}</span>
            </li>
          ))}
        </ul>
      </details>
    </>
  )
}

/** 10px is the documented floor for a key cap and nothing else: `esc` set at 13px is wider than the
 *  word it labels, and the legend is five of them in a header that has to survive 720px. */
function LegendKey({ keys }: { keys: string }) {
  return (
    <kbd className="rounded-sm border border-line-strong bg-base px-1 font-mono text-micro text-muted">
      {keys}
    </kbd>
  )
}
