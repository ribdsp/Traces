'use client'

import { useEffect, useState } from 'react'

/**
 * A wall clock that re-renders, for the two places that show elapsed real time.
 *
 * `ActivityEntry.at` and `AskHumanVisual.askedAt` are `Date.now()` values, not recording times, so "3s
 * ago" and "waiting 14s" go stale the moment they are painted. A shared ticker keeps that in one place and
 * makes the cost explicit: one interval per consumer, at whatever coarseness that consumer actually needs.
 *
 * Null until mounted, deliberately. Every page here is prerendered at build time — `next build` reports
 * `/` as `○ (Static)` — so a `Date.now()` read during the first render is a value the prerendered HTML
 * could not have contained; the hydration warning that follows is noise at best and a mismatched tree at
 * worst. Callers render an absolute label, or nothing, until the clock starts.
 */
export function useWallClock(intervalMs: number): number | null {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())

    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return now
}

/**
 * "just now", then live seconds: "12s ago", "90s ago".
 *
 * Seconds only, never minutes. The activity line is watched while the agent works, and a counter that
 * jumps to "1m ago" and then sits still reads as frozen. Ticking in seconds is the whole point of the
 * clock the feed already subscribed to.
 */
export function formatAgo(atEpochMs: number, nowEpochMs: number): string {
  const seconds = Math.max(Math.round((nowEpochMs - atEpochMs) / 1000), 0)
  if (seconds < 2) return 'just now'
  return `${seconds}s ago`
}
