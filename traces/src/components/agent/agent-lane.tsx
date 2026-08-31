'use client'

import { Check, Circle, CircleHelp, ListTodo, MousePointerClick, Search } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
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
 * one of the seventeen tools reads from.
 *
 * Show `claimed` distinctly from `open`. Watching a task flip to claimed a second after you typed it,
 * with no click in between, is the clearest demonstration in the whole app that something else is
 * genuinely reading this page.
 *
 * It is labelled a queue rather than a lane, and the copy is written to say so. "Agent lane" over a
 * textarea reads as a chat box, and a viewer who reads it that way is waiting for a reply that will never
 * come: nothing here answers, because the other end of this box is a *blocking call*. Naming the mechanism
 * costs two sentences in the empty state and is the difference between a demo that looks broken and one
 * that looks inverted on purpose.
 *
 * What shipped, and why:
 *   - three treatments, because the flip between them is the demonstration: `open` waiting, `claimed`
 *     with a live "working" indication and how long it has been held, `done` struck through. The flip is
 *     carried by four things at once — the status word, the chip behind it, the rail on the left and the
 *     row's own tint — because it happens in well under a second and a viewer gets one chance to see it.
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
 * Every line of copy below is written to that limit: it describes the call, never a caller.
 */

/** So Day 6's shortcut can put focus here without threading a ref through the layout. */
export const AGENT_LANE_INPUT_ID = 'traces-agent-lane-input'

/**
 * Concrete enough to be worth handing over.
 *
 * Each one is a real question about the `empty-province` sample, phrased the way the tools want to be
 * driven — a moment to find, then a claim to check.
 */
const EXAMPLES: readonly { text: string; icon: LucideIcon }[] = [
  { text: 'Find when the province dropdown went empty', icon: Search },
  { text: 'Check whether the submit button was ever enabled', icon: MousePointerClick },
  { text: 'Explain why the address form rejected a valid postcode', icon: CircleHelp },
]

/**
 * The three states, as four simultaneous signals each.
 *
 * `rail` is the 2px edge, `chip` the status word's own background, `row` the surface behind the whole
 * line, `text` the task itself. `claimed` is the only one that tints the row, because it is the only one
 * that is *happening* — and `warn` is the right family for it: something is holding the line and the
 * viewer should look. It is not an error, which is why nothing here reaches for `error`.
 */
const TREATMENTS: Record<TaskStatus, { rail: string; chip: string; row: string; text: string }> = {
  open: { rail: 'border-line-strong', chip: 'bg-raised text-muted', row: '', text: 'text-ink' },
  claimed: {
    rail: 'border-warn',
    chip: 'bg-warn/20 text-warn',
    row: 'bg-warn/5',
    text: 'text-ink',
  },
  done: {
    rail: 'border-line',
    chip: 'bg-panel text-faint',
    row: '',
    text: 'text-muted line-through',
  },
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

  const claimed = tasks.filter((task) => task.status === 'claimed').length
  const open = tasks.filter((task) => task.status === 'open').length

  return (
    <section className="border-b border-line p-3">
      <SectionHeading label="Task queue" icon={ListTodo}>
        {/*
          A count, not a status: it says how deep the queue is, which is the one number a queue is read
          for. Mono and tabular so a task flipping from open to claimed does not shuffle the digits.
        */}
        {tasks.length > 0 ? (
          <span className="ml-auto shrink-0 font-mono text-label tabular-nums text-faint">
            {claimed > 0 ? <span className="text-warn">{claimed} claimed</span> : null}
            {claimed > 0 && open > 0 ? <span aria-hidden> · </span> : null}
            {open > 0 ? `${open} open` : null}
          </span>
        ) : null}
      </SectionHeading>

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
        placeholder="Add a task to the queue — Enter to queue it, Shift+Enter for a newline"
        aria-label="Add a task to the queue"
        className="w-full resize-none rounded-sm border border-line-strong bg-base px-2 py-1 text-body leading-relaxed text-ink placeholder:text-faint hover:border-faint"
      />
    </section>
  )
}

function TaskRow({ task, now }: { task: Task; now: number | null }) {
  const treatment = TREATMENTS[task.status]

  return (
    <li
      className={`flex items-baseline gap-1.5 rounded-sm border-l-2 py-1 pl-2 pr-1.5 text-body ${treatment.rail} ${treatment.row}`}
    >
      <span
        className={`inline-flex shrink-0 items-center gap-1 rounded-sm px-1 font-mono text-label uppercase tracking-wide ${treatment.chip}`}
      >
        {task.status === 'open' ? (
          <Circle aria-hidden size={10} strokeWidth={1.75} />
        ) : null}
        {task.status === 'done' ? (
          <Check aria-hidden size={10} strokeWidth={2} />
        ) : null}
        {task.status}
      </span>

      {/*
        The working indication. `animate-pulse` rather than a spinner because reduced motion caps this at one
        iteration (see globals.css), which settles it on `opacity: 1` — a static dot rather than nothing. A
        rotating glyph frozen at 0deg would say "idle" instead, and the row's amber rail and `claimed` chip
        are what carry the state when the motion is gone.
      */}
      {task.status === 'claimed' ? (
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 self-center animate-pulse rounded-full bg-warn" />
      ) : null}

      <span className={`min-w-0 ${treatment.text}`}>{task.text}</span>
      <AuthorBadge author={task.author} />

      {task.status === 'claimed' && task.claimedAt !== undefined && now !== null ? (
        <span className="ml-auto shrink-0 font-mono text-label tabular-nums text-faint">
          held {formatAgo(task.claimedAt, now)}
        </span>
      ) : null}
    </li>
  )
}

function EmptyLane({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="mb-2 text-body leading-relaxed">
      <p className="text-muted">
        Nothing in the queue. An agent takes work from here by calling{' '}
        <span className="font-mono text-ink">claim_next_task</span>, which{' '}
        <span className="text-ink">blocks</span> until you press Enter — whatever you type below is what
        that call returns.
      </p>

      <p className="mt-2 text-meta text-faint">Something worth handing over:</p>

      <ul className="mt-1 space-y-1">
        {EXAMPLES.map((example) => (
          <li key={example.text}>
            <button
              type="button"
              onClick={() => onPick(example.text)}
              title="Put this in the box below. It is not queued until you press Enter."
              className="flex w-full items-start gap-1.5 rounded-sm border border-line px-1.5 py-1 text-left text-meta text-muted hover:border-faint hover:bg-raised/60 hover:text-ink"
            >
              <example.icon aria-hidden size={13} strokeWidth={1.75} className="mt-0.5 shrink-0 text-faint" />
              <span>{example.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
