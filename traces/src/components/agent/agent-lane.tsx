'use client'

import { useState } from 'react'
import { sessionActions, useSessionStore } from '@/lib/store/session'
import { AuthorBadge } from '@/components/ui/author-badge'

/**
 * Where a human hands work to the agent.
 *
 * Owner: Faiq. Pairs with `claim_next_task`.
 *
 * A human types a task; the agent picks it up by calling `claim_next_task`, which blocks until one
 * exists. That inversion is the interesting part — the agent waits on the person rather than the
 * person waiting on the agent — and it means the lane is not a UI convenience, it is the queue that
 * one of the sixteen tools reads from.
 *
 * Show `claimed` distinctly from `open`. Watching a task flip to claimed a second after you typed it,
 * with no click in between, is the clearest demonstration in the whole app that something else is
 * genuinely reading this page.
 */
export function AgentLane() {
  const tasks = useSessionStore((s) => s.tasks)
  const [draft, setDraft] = useState('')

  const submit = () => {
    const text = draft.trim()
    if (!text) return
    sessionActions().addTask(text, 'human')
    setDraft('')
  }

  /**
   * TODO(faiq), Day 4:
   *   - three states with distinct treatments: open, claimed (with a "working" indication), done
   *   - Enter submits, Shift+Enter for a newline
   *   - suggest two or three example tasks when the lane is empty. "Find when the province dropdown
   *     went empty" teaches the interaction better than placeholder text does
   *   - no delete for claimed tasks: the agent may already be inside `claim_next_task`, and yanking
   *     the task out from under an in-flight gate is a bug you will not enjoy finding
   */
  return (
    <section className="border-b border-zinc-800 p-3">
      <h2 className="mb-2 text-[11px] uppercase tracking-wide text-zinc-500">Agent lane</h2>

      <ul className="mb-2 space-y-1">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-center gap-2 text-xs text-zinc-300">
            <span className="font-mono text-[10px] text-zinc-500">{task.status}</span>
            <span>{task.text}</span>
            <AuthorBadge author={task.author} />
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) submit()
          }}
          placeholder="Hand the agent a task"
          className="w-full border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600"
        />
      </div>
    </section>
  )
}
