'use client'

import { AgentLane } from '@/components/agent/agent-lane'
import { ActivityFeed } from '@/components/agent/activity-feed'
import { AskHumanVisualPrompt } from '@/components/agent/ask-human-visual-prompt'
import { HypothesisCards } from '@/components/agent/hypothesis-cards'
import { ReportDraft } from '@/components/agent/report-draft'
import { MarkPointOverlay } from '@/components/player/mark-point-overlay'
import { PlayerControls } from '@/components/player/player-controls'
import { ReplayStage } from '@/components/player/replay-stage'
import { Timeline } from '@/components/timeline/timeline'

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
 * during a screen recording is a page where the important part is off-frame half the time.
 *
 * TODO(faiq), Day 2 for the shell, Day 6 for the polish:
 *   - a recording picker in the header, reading the sample recordings from public/recordings
 *   - resizable split, with the ratio remembered in localStorage
 *   - the header states what this is in one line, for the judge who arrives with no context
 *   - a keyboard shortcut for the panel most used during the demo
 */
export default function Home() {
  return (
    <main className="flex h-[calc(100vh-1.75rem)] flex-col">
      <div className="flex min-h-0 flex-1">
        <section className="relative flex min-w-0 flex-1 flex-col border-r border-zinc-800">
          <div className="relative min-h-0 flex-1">
            <ReplayStage />
            <MarkPointOverlay />
          </div>
          <PlayerControls />
        </section>

        <aside className="flex w-[380px] shrink-0 flex-col overflow-auto">
          <AskHumanVisualPrompt />
          <AgentLane />
          <HypothesisCards />
          <ReportDraft />
          <ActivityFeed />
        </aside>
      </div>

      <Timeline />
    </main>
  )
}
