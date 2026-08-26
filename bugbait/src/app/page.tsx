'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { armScenario, type Bug } from '@/lib/bugs'
import { RecorderPanel } from '@/components/recorder-panel'

/**
 * The cart. The recording starts here.
 *
 * Owner: Vicko.
 *
 * It exists so the session has a beginning that isn't the broken page. An agent investigating a
 * checkout failure benefits from a recording that includes the navigation into checkout — that
 * navigation is in `read_session_meta`, and "the bug appeared 4s after entering /checkout" is a much
 * more useful sentence than "the bug was present at 12s".
 *
 * Keep the interaction here small and natural: adjust a quantity, then continue. Enough to make the
 * session look like a real one, not so much that the demo video spends its first ten seconds shopping.
 *
 * Day 5 (vicko) — implemented. Two things about it that are less obvious than they look:
 *
 *   - the "Continue to checkout" link carries **no** `?bug=` parameter. The scenario is armed once, on
 *     arrival, and then lives in `sessionStorage` (see `armScenario`), because a query parameter would
 *     be stamped into every rrweb Meta event and hand the agent the answer through
 *     `read_session_meta`. The flow is still one session and still reproducible from a URL you type.
 *   - the scenario picker is in the recorder panel, which is never captured, and not on this page.
 */

type CartLine = { id: string; name: string; unitPrice: number; quantity: number }

const INITIAL_LINES: readonly CartLine[] = [
  { id: 'kbd', name: 'Mechanical keyboard, 65%', unitPrice: 890_000, quantity: 1 },
  { id: 'cbl', name: 'USB-C cable, 2 m', unitPrice: 75_000, quantity: 2 },
  { id: 'mat', name: 'Desk mat, felt', unitPrice: 210_000, quantity: 1 },
]

const SHIPPING = 25_000

function rupiah(amount: number): string {
  return `Rp${amount.toLocaleString('id-ID')}`
}

export default function CartPage() {
  const [lines, setLines] = useState<CartLine[]>(() => INITIAL_LINES.map((line) => ({ ...line })))
  const [armed, setArmed] = useState<Bug | null>(null)

  // Runs before any recording can start — the Start button is in a panel that only appears after this
  // effect — so the `?bug=` parameter is out of the address bar before rrweb takes its first snapshot.
  useEffect(() => {
    setArmed(armScenario())
  }, [])

  const subtotal = useMemo(
    () => lines.reduce((total, line) => total + line.unitPrice * line.quantity, 0),
    [lines],
  )

  const setQuantity = (id: string, delta: number) => {
    setLines((current) =>
      current.map((line) =>
        line.id === id ? { ...line, quantity: Math.max(1, Math.min(9, line.quantity + delta)) } : line,
      ),
    )
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-xl font-semibold">Your cart</h1>

      <ul className="mt-6 divide-y divide-gray-200 border-y border-gray-200">
        {lines.map((line) => (
          <li key={line.id} className="flex items-center justify-between gap-4 py-3">
            <div>
              <p className="text-sm font-medium">{line.name}</p>
              <p className="text-xs text-gray-500">{rupiah(line.unitPrice)} each</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                id={`decrease-${line.id}`}
                aria-label={`Decrease quantity of ${line.name}`}
                onClick={() => setQuantity(line.id, -1)}
                className="h-7 w-7 border border-gray-300 text-sm"
              >
                −
              </button>
              <span id={`quantity-${line.id}`} className="w-6 text-center text-sm tabular-nums">
                {line.quantity}
              </span>
              <button
                type="button"
                id={`increase-${line.id}`}
                aria-label={`Increase quantity of ${line.name}`}
                onClick={() => setQuantity(line.id, 1)}
                className="h-7 w-7 border border-gray-300 text-sm"
              >
                +
              </button>
              <span className="w-28 text-right text-sm tabular-nums">
                {rupiah(line.unitPrice * line.quantity)}
              </span>
            </div>
          </li>
        ))}
      </ul>

      <dl className="mt-4 space-y-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-gray-500">Subtotal</dt>
          <dd id="subtotal" className="tabular-nums">
            {rupiah(subtotal)}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-500">Shipping</dt>
          <dd className="tabular-nums">{rupiah(SHIPPING)}</dd>
        </div>
        <div className="flex justify-between border-t border-gray-200 pt-1 font-medium">
          <dt>Total</dt>
          <dd id="total" className="tabular-nums">
            {rupiah(subtotal + SHIPPING)}
          </dd>
        </div>
      </dl>

      <Link
        href="/checkout"
        id="continue-to-checkout"
        className="mt-6 inline-block border border-gray-900 bg-gray-900 px-4 py-2 text-sm text-white"
      >
        Continue to checkout
      </Link>

      <RecorderPanel armed={armed} />
    </main>
  )
}
