'use client'

import { Check, TriangleAlert, X } from 'lucide-react'
import { useEffect, useState } from 'react'

/**
 * Failures used to render next to the control that caused them, which pushed the empty state around.
 * One card in the top-right is where every notice in this app now lands — errors and copy confirmations.
 *
 * Only the latest notice is kept. Stacking every drop of a rejected file built a tower that covered the
 * agent column and then sat there, which is the failure the screenshot of seven identical toasts is of.
 */

export type AppToast = {
  id: number
  kind: 'error' | 'ok'
  title: string
  detail: string
}

const HOLD_MS = 5_000

let nextId = 1
let queue: AppToast[] = []
let hideTimer = 0
const listeners = new Set<(toasts: AppToast[]) => void>()

function emit() {
  for (const listener of listeners) listener(queue)
}

function show(kind: AppToast['kind'], title: string, detail: string): void {
  const toast: AppToast = { id: nextId++, kind, title, detail }
  queue = [toast]
  emit()
  if (hideTimer) window.clearTimeout(hideTimer)
  hideTimer = window.setTimeout(() => dismissToast(toast.id), HOLD_MS)
}

export function reportError(title: string, detail: string): void {
  show('error', title, detail)
}

export function reportSuccess(title: string, detail: string): void {
  show('ok', title, detail)
}

export function dismissToast(id: number): void {
  queue = queue.filter((toast) => toast.id !== id)
  emit()
}

function useToastQueue(): AppToast[] {
  const [toasts, setToasts] = useState(queue)

  useEffect(() => {
    listeners.add(setToasts)
    return () => {
      listeners.delete(setToasts)
    }
  }, [])

  return toasts
}

export function ErrorToasts() {
  const toasts = useToastQueue()
  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed right-3 top-14 z-50 w-[16rem] max-w-[calc(100vw-1.5rem)]">
      {toasts.map((toast) => {
        const error = toast.kind === 'error'
        return (
          <p
            key={toast.id}
            role={error ? 'alert' : 'status'}
            className={`pointer-events-auto flex items-start gap-1.5 rounded-sm border px-1.5 py-1 text-label leading-snug shadow-raised ${
              error
                ? 'border-error/50 bg-base/90 text-error'
                : 'border-ok/50 bg-base/90 text-ok'
            }`}
          >
            {error ? (
              <TriangleAlert aria-hidden size={14} strokeWidth={1.75} className="mt-px shrink-0" />
            ) : (
              <Check aria-hidden size={14} strokeWidth={2} className="mt-px shrink-0" />
            )}
            <span className="min-w-0 flex-1">
              <span className="font-medium">{toast.title}</span>
              {toast.detail ? <span className="mt-0.5 block opacity-80">{toast.detail}</span> : null}
            </span>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              aria-label="Dismiss"
              className="shrink-0 rounded-sm p-0.5 opacity-70 hover:bg-base/10 hover:opacity-100"
            >
              <X aria-hidden size={12} strokeWidth={2} />
            </button>
          </p>
        )
      })}
    </div>
  )
}