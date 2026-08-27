'use client'

import { useEffect, useState } from 'react'

/**
 * A wall clock that re-renders, for the two places that show elapsed real time.
 *
 * Owner: Faiq.
 *
 * `ActivityEntry.at` and `AskHumanVisual.askedAt` are `Date.now()` values, not recording times, so "3s
 * ago" and "waiting 14s" go stale the moment they are painted. A shared ticker keeps that in one place and
 * makes the cost explicit: one interval per consumer, at whatever coarseness that consumer actually needs.
 *
 * Null until mounted, deliberately. This app is a static export, so a `Date.now()` read during the first
 * render is a value the server could not have produced — the hydration warning that follows is noise at
 * best and a mismatched tree at worst. Callers render an absolute label, or nothing, until the clock starts.
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
 * "just now", "12s ago", "4m ago".
 *
 * Coarse on purpose: the feed is read to reconstruct an order of events, and a precise age on every line
 * invites reading it as a measurement. Minutes is as far as it goes — a session that outlives that is not
 * one anybody is still watching live.
 */
export function formatAgo(atEpochMs: number, nowEpochMs: number): string {
  const seconds = Math.max(Math.round((nowEpochMs - atEpochMs) / 1000), 0)
  if (seconds < 3) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  return `${Math.floor(seconds / 60)}m ago`
}
