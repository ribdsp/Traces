'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The two-panel split, with a divider a human can move.
 *
 * There is exactly one split in this app, which is why this renders `section` and `aside` rather than
 * two anonymous divs: the replay is the content, the agent's lane is beside it, and that reading should
 * survive being handed to a screen reader.
 *
 * Why it is resizable at all, given that it costs more than a fixed width: during a demo the interesting
 * half changes. Explaining the bisect means widening the agent's lane; showing the bug means widening the
 * replay. Doing that by dragging is one gesture; doing it by editing a Tailwind class is a rebuild.
 *
 * The width is remembered so a reload mid-demo does not undo the arrangement. It is stored, read after
 * mount, and clamped on read — a stale value from a wider window must not push a panel off-screen.
 */

interface ResizableSplitProps {
  left: React.ReactNode
  right: React.ReactNode
  leftLabel: string
  rightLabel: string
  storageKey?: string
}

const DEFAULT_WIDTH = 380
const MIN_WIDTH = 300
const MAX_WIDTH = 640
const KEYBOARD_STEP = 16

const clamp = (value: number) => Math.min(Math.max(value, MIN_WIDTH), MAX_WIDTH)

export function ResizableSplit({
  left,
  right,
  leftLabel,
  rightLabel,
  storageKey = 'traces:split-width',
}: ResizableSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [dragging, setDragging] = useState(false)

  /** Read after mount: the page is prerendered, and localStorage during render is a hydration mismatch. */
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey)
      if (stored === null) return

      const parsed = Number.parseInt(stored, 10)
      if (Number.isFinite(parsed)) setWidth(clamp(parsed))
    } catch {
      /* Private mode and blocked storage both throw on read. A default width is a fine outcome. */
    }
  }, [storageKey])

  const persist = useCallback(
    (next: number) => {
      try {
        window.localStorage.setItem(storageKey, String(next))
      } catch {
        /* Not worth telling anyone about: the split still works, it just forgets. */
      }
    },
    [storageKey],
  )

  const resizeTo = useCallback(
    (next: number) => {
      const clamped = clamp(next)
      setWidth(clamped)
      persist(clamped)
    },
    [persist],
  )

  /** Pointer capture, so a fast drag that leaves the 3px handle keeps resizing instead of stopping. */
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return

    const bounds = containerRef.current?.getBoundingClientRect()
    if (!bounds) return

    resizeTo(bounds.right - event.clientX)
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId)
    setDragging(false)
  }

  /** A divider only draggable by mouse is a divider half the room cannot move. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === 'ArrowLeft' ? KEYBOARD_STEP : event.key === 'ArrowRight' ? -KEYBOARD_STEP : 0

    if (step !== 0) {
      event.preventDefault()
      resizeTo(width + step)
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      resizeTo(MAX_WIDTH)
    } else if (event.key === 'End') {
      event.preventDefault()
      resizeTo(MIN_WIDTH)
    }
  }

  return (
    <div
      ref={containerRef}
      className={`flex min-h-0 flex-1 ${dragging ? 'select-none' : ''}`}
    >
      <section aria-label={leftLabel} className="flex min-w-0 flex-1 flex-col">
        {left}
      </section>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the agent panel"
        aria-valuenow={Math.round(width)}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={onKeyDown}
        className={`w-[3px] shrink-0 cursor-col-resize touch-none outline-none transition-colors ${
          dragging ? 'bg-sky-500/70' : 'bg-zinc-800 hover:bg-zinc-600 focus-visible:bg-sky-500/70'
        }`}
      />

      <aside
        aria-label={rightLabel}
        style={{ width }}
        className="flex shrink-0 flex-col overflow-auto"
      >
        {right}
      </aside>
    </div>
  )
}
