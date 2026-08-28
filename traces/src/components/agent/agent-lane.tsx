'use client'

import { useState } from 'react'
import { AuthorBadge } from '@/components/ui/author-badge'
import { formatAgo, useWallClock } from '@/components/ui/use-clock'
import { SectionHeading } from '@/components/ui/section-heading'
import { sessionActions, useSessionStore } from '@/lib/store/session'
import type { Task, TaskStatus } from '@/types/domain'

/**
 * Where a human hands work to the agent.
 *
 * Pairs with `claim_next_task`.
 *
 * A human types a task; the agent picks it up by calling `claim_next_task`, which blocks until one
 * exists. That inversion is the interesting part — the agent waits on the person rather than the
 * person waiting on the agent — and it means the lane is not a UI convenience, it is the queue that
 * one of the sixteen tools reads from.
 *
 * Show `claimed` distinctly from `open`. Watching a task flip to claimed a second after you typed it,
 * with no click in between, is the clearest demonstration in the whole app that something else is
 * genuinely reading this page.
 *
 * What shipped, and why:
 *   - three treatments, because the flip between them is the demonstration: `open` waiting, `claimed`
 *     with a live "working" indication and how long it has been held, `done` struck through
 *   - Enter submits and Shift+Enter starts a newline, which needs a textarea rather than an input
 *   - example tasks while the lane is empty. They fill the box rather than submitting, because the thing
 *     worth teaching is that this is where you talk to the agent — not that clicking here queues work.
 *   - no delete, and no human-side "done". Neither is an oversight: there is no `removeTask` action to call,
 *     and pulling a task out from under an in-flight `claim_next_task` gate is the bug that would justify
 *     never adding one. `completeTask` logs as the *agent*, so a human pressing "done" would sign the
 *     agent's name to it.
 *
 * One thing the lane cannot show: an agent already blocked inside `claim_next_task` with nothing to claim.
 * The gate is held in `lib/webmcp`, `SessionState` is frozen, and nothing observable says a caller is
 * waiting — so the lane says what happens when a task arrives instead of claiming to know who is listening.
 */

/** So Day 6's shortcut can put focus here without threading a ref through the layout. */
export const AGENT_LANE_INPUT_ID = 'traces-agent-lane-input'

/**
 * Concrete enough to be worth handing over.
 *
 * Each one is a real question about the `empty-province` sample, phrased the way the tools want to be
 * driven — a moment to find, then a claim to check.
 */
const EXAMPLES = [
  'Find when the province dropdown went empty',
  'Check whether the submit button was ever enabled',
  'Explain why the address form rejected a valid postcode',
]

const TREATMENTS: Record<TaskStatus, { row: string; label: string; text: string }> = {
  open: { row: 'border-line', label: 'text-muted', text: 'text-ink' },
  claimed: { row: 'border-warn/50', label: 'text-warn', text: 'text-ink' },
  done: { row: 'border-line', label: 'text-faint', text: 'text-muted line-through' },
}

export function AgentLane() {
  const tasks = useSessionStore((s) => s.tasks)
  const [draft, setDraft] = useState('')
  const now = useWallClock(1_000)

  const submit = () => {
    const text = draft.trim()
    if (!text) return
    sessionActions().addTask(text, 'human')
    setDraft('')
  }

  return (
    <section className="border-b border-line p-3">
      <SectionHeading label="Agent lane" />

      {tasks.length === 0 ? (
        <EmptyLane onPick={setDraft} />
      ) : (
        <ul className="mb-2 space-y-1">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} now={now} />
          ))}
        </ul>
      )}

      <textarea
        id={AGENT_LANE_INPUT_ID}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey) return
          // Otherwise the newline is inserted as well and the box keeps a blank line after every task.
          event.preventDefault()
          submit()
        }}
        rows={2}
        placeholder="Hand the agent a task — Enter to send, Shift+Enter for a newline"
        aria-label="Hand the agent a task"
        className="w-full resize-none border border-line bg-base px-2 py-1 text-xs leading-relaxed text-ink placeholder:text-faint focus:border-ink focus:outline-none"
      />
    </section>
  )
}

function TaskRow({ task, now }: { task: Task; now: number | null }) {
  const treatment = TREATMENTS[task.status]

  return (
    <li className={`flex items-baseline gap-2 border-l pl-2 text-xs ${treatment.row}`}>
      <span className={`shrink-0 font-mono text-[10px] ${treatment.label}`}>{task.status}</span>

      {/*
        The working indication. `animate-pulse` rather than a spinner because globals.css zeroes animation
        duration under prefers-reduced-motion, which turns this into a static dot instead of removing it.
      */}
      {task.status === 'claimed' ? (
        <span aria-hidden className="h-1 w-1 shrink-0 animate-pulse rounded-full bg-warn" />
      ) : null}

      <span className={treatment.text}>{task.text}</span>
      <AuthorBadge author={task.author} />

      {task.status === 'claimed' && task.claimedAt !== undefined && now !== null ? (
        <span className="ml-auto shrink-0 font-mono text-[10px] text-faint">
          working, claimed {formatAgo(task.claimedAt, now)}
        </span>
      ) : null}
    </li>
  )
}

function EmptyLane({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="mb-2 text-[10px] leading-relaxed text-faint">
      <p>
        Nothing queued. An agent calling <span className="font-mono">claim_next_task</span> waits here
        until you add something, then takes it without being asked twice.
      </p>

      <ul className="mt-1.5 space-y-0.5">
        {EXAMPLES.map((example) => (
          <li key={example}>
            <button
              type="button"
              onClick={() => onPick(example)}
              className="text-left text-muted underline decoration-dotted hover:text-ink focus-visible:bg-raised focus-visible:text-ink focus-visible:outline-none"
            >
              {example}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
