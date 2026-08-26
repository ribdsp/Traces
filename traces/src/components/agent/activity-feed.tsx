'use client'

import { sessionActions, useSessionStore } from '@/lib/store/session'
import { AuthorBadge } from '@/components/ui/author-badge'

/**
 * A running account of who did what.
 *
 * Owner: Faiq.
 *
 * The feed is correct for free if the store's rules hold: every mutation goes through an action, and
 * every action appends one entry carrying its `author`. If an entry is ever missing here, the bug is
 * in the store — something wrote state directly — and this component is the place it becomes visible.
 * That makes the feed a debugging tool as much as a feature.
 *
 * Newest first, and undo lives on the entry rather than in a global "undo last" button. The human's
 * veto is per-contribution: reject the agent's third marker without touching the other two.
 */
export function ActivityFeed() {
  const activity = useSessionStore((s) => s.activity)

  /**
   * TODO(faiq), Day 4:
   *   - newest first, and auto-scroll only when already at the top (nothing worse than a feed that
   *     yanks itself while you are reading it)
   *   - relative wall-clock time — "3s ago" — since these are real-time actions, not recording times
   *   - undo on entries where `undoable` is set, calling undo(id)
   *   - an empty state that says what will appear here, not "no activity"
   */
  return (
    <section className="flex-1 overflow-auto p-3">
      <h2 className="mb-2 text-[11px] uppercase tracking-wide text-zinc-500">Activity</h2>

      <ul className="space-y-1">
        {activity.map((entry) => (
          <li key={entry.id} className="flex items-baseline gap-1 text-xs text-zinc-400">
            <span>{entry.description}</span>
            <AuthorBadge author={entry.author} />
            {entry.undoable ? (
              <button
                type="button"
                onClick={() => sessionActions().undo(entry.id)}
                className="ml-auto text-[10px] text-zinc-500 underline"
              >
                undo
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
