'use client'

import { useEffect, useRef } from 'react'
import { AuthorBadge } from '@/components/ui/author-badge'
import { formatAgo, useWallClock } from '@/components/ui/use-clock'
import { sessionActions, useSessionStore } from '@/lib/store/session'
import type { ActivityEntry } from '@/types/domain'

/**
 * A running account of who did what.
 *
 * The feed is correct for free if the store's rules hold: every mutation goes through an action, and
 * every action appends one entry carrying its `author`. If an entry is ever missing here, the bug is
 * in the store — something wrote state directly — and this component is the place it becomes visible.
 * That makes the feed a debugging tool as much as a feature.
 *
 * Newest first, and undo lives on the entry rather than in a global "undo last" button. The human's
 * veto is per-contribution: reject the agent's third marker without touching the other two.
 *
 * What shipped, and why:
 *   - newest first, and the list scrolls itself to the top only when it was already there. Reading history
 *     while an agent works is the case that matters: `[overflow-anchor:none]` plus a scroll correction keeps
 *     the same lines under the eye in every browser, rather than depending on native scroll anchoring, which
 *     Safari does not implement.
 *   - "3s ago", from `entry.at`, which is wall-clock — never recording time. The exact clock time is in the
 *     title, for anyone cross-referencing this against a console log.
 *   - undo where `undoable` is set. Only agent entries carry it, which is the asymmetry the project argues
 *     for: the human can revert the agent, and the agent cannot revert the human.
 *   - an empty state that says what will appear here. "No activity" describes the widget; this describes the
 *     mechanism, and the mechanism is the thing being demonstrated.
 */

/** Within this many pixels of the top counts as "reading the newest", so the list keeps following. */
const AT_TOP_PX = 8

export function ActivityFeed() {
  const activity = useSessionStore((s) => s.activity)
  const scrollRef = useRef<HTMLDivElement>(null)
  const previousHeight = useRef(0)

  /** Coarse: the labels are minutes and seconds, and a feed that re-renders faster than it changes is waste. */
  const now = useWallClock(5_000)

  useEffect(() => {
    const list = scrollRef.current
    if (!list) return

    if (list.scrollTop <= AT_TOP_PX) {
      list.scrollTop = 0
    } else {
      // New entries go in above whatever is being read, which moves it down the page by exactly the height
      // they added. Following that shift is what keeps the line someone is mid-sentence on where it was.
      const grew = list.scrollHeight - previousHeight.current
      if (grew > 0) list.scrollTop += grew
    }

    previousHeight.current = list.scrollHeight
  }, [activity])

  return (
    <section className="flex min-h-[8rem] flex-1 flex-col p-3">
      <div className="mb-2 flex shrink-0 items-baseline justify-between gap-2">
        <h2 className="text-[11px] uppercase tracking-wide text-zinc-500">Activity</h2>
        {activity.length > 0 ? (
          <span className="font-mono text-[10px] text-zinc-600">{activity.length}</span>
        ) : null}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto [overflow-anchor:none]">
        {activity.length === 0 ? (
          <EmptyFeed />
        ) : (
          <ul className="space-y-1">
            {/* Newest first. Reversed for display only — the store's order is the record. */}
            {[...activity].reverse().map((entry) => (
              <FeedRow key={entry.id} entry={entry} now={now} />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function FeedRow({ entry, now }: { entry: ActivityEntry; now: number | null }) {
  return (
    <li className="flex items-baseline gap-1 text-xs leading-relaxed text-zinc-400">
      <span className="min-w-0">{entry.description}</span>
      <AuthorBadge author={entry.author} />

      <span className="ml-auto flex shrink-0 items-baseline gap-1.5 pl-1">
        {/*
          Absolute time until the clock starts, so the first paint of a static export is not a wall-clock
          read the server could not have made.
        */}
        <span
          className="font-mono text-[10px] text-zinc-600"
          title={new Date(entry.at).toLocaleTimeString()}
        >
          {now === null ? '' : formatAgo(entry.at, now)}
        </span>

        {entry.undoable ? (
          <button
            type="button"
            onClick={() => sessionActions().undo(entry.id)}
            title="Undo exactly this contribution. Everything else the agent did stays."
            className="text-[10px] uppercase tracking-wide text-zinc-500 underline decoration-dotted hover:text-zinc-100"
          >
            undo
          </button>
        ) : null}
      </span>
    </li>
  )
}

function EmptyFeed() {
  return (
    <p className="text-[11px] leading-relaxed text-zinc-600">
      Every action lands here as it happens, labelled with who took it — the agent seeking, bisecting and
      annotating, and you marking, rejecting and answering. Anything the agent did can be undone from its own
      line.
    </p>
  )
}
