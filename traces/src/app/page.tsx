'use client'

import { AgentLane } from '@/components/agent/agent-lane'
import { ActivityFeed } from '@/components/agent/activity-feed'
import { AskHumanVisualPrompt } from '@/components/agent/ask-human-visual-prompt'
import { HypothesisCards } from '@/components/agent/hypothesis-cards'
import { ReportDraft } from '@/components/agent/report-draft'
import { PlayerControls } from '@/components/player/player-controls'
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
 * TODO(faiq), Day 6 for the polish:
 *   - a keyboard shortcut for the panel most used during the demo
 */
export default function Home() {
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
