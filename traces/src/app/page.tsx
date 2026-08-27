'use client'

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

/**
 * The whole app, on one screen.
 *
 * Owner: Faiq.
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
 * MarkPointOverlay is no longer mounted here: it belongs to the stage it dims, and mounting it in both
 * places would have rendered the question twice the day `pendingAsk` first got set.
 *
 * Implemented — faiq, Day 6:
 *   - `a` focuses the agent lane and `p` focuses the scrubber, which are the two things a hand reaches for
 *     during the demo: hand the agent a task, then drive the replay. Both are a long mouse trip apart on a
 *     1280px screen, and the panel between them is where the interesting output appears.
 *   - `esc` releases focus from whatever is being typed in, which is the shortcut that makes the other two
 *     safe to use. Space plays only while nothing has the keyboard, so without a way back out, the first
 *     `a` costs the player its controls until someone clicks the stage.
 *   - the keys are listed in the header rather than hidden in a help dialog. Five of them fit in the space
 *     the description was already truncating, and a shortcut nobody is told about is one nobody presses.
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
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-800 px-3 py-1.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="shrink-0 text-xs font-medium tracking-tight text-zinc-100">Traces</h1>
          <p className="truncate text-[11px] text-zinc-500">
            Session replay an AI agent can interrogate — it reads the DOM at any moment, binary-searches
            the timeline, and asks you to look when it cannot see.
          </p>
        </div>

        <ShortcutLegend />
        <RecordingPicker />
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
 * Hidden below `lg` rather than wrapped: it is a convenience for a keyboard, and the layout it would push
 * around is the one thing on this page that must not start scrolling.
 */
function ShortcutLegend() {
  return (
    <ul
      title="Keyboard: space plays and pauses, the arrows step 100ms (hold shift for a second), a focuses the agent lane, p focuses the scrubber, and escape hands the keyboard back to the player."
      className="hidden shrink-0 items-center gap-2 pt-0.5 text-[10px] text-zinc-600 lg:flex"
    >
      {LEGEND.map((item) => (
        <li key={item.keys} className="flex items-center gap-1">
          <kbd className="border border-zinc-800 px-1 font-mono text-[9px] text-zinc-400">
            {item.keys}
          </kbd>
          <span>{item.does}</span>
        </li>
      ))}
    </ul>
  )
}
