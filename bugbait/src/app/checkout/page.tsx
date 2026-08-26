'use client'

import { useEffect, useState } from 'react'
import { activeBug, BUG_SPECS, type Bug } from '@/lib/bugs'

/**
 * The checkout form. Every bug lives here.
 *
 * Owner: Vicko.
 *
 * The form has to be genuinely ordinary — name, address, province, city, postcode, card, pay — because
 * the investigation is only interesting if the page looks like something that would ship. A page with
 * one dropdown and a broken button demonstrates nothing; the agent has to actually find the failing
 * element among plausible neighbours.
 *
 * Three requirements that are easy to lose while making the bug work:
 *
 *   1. **Stable selectors.** Every field gets an `id`. `bisect` takes a CSS selector, and a selector
 *      that stops matching between probes produces `elementMissing` on half the trace — a real bug in a
 *      recording that is supposed to be a fixture.
 *   2. **A misleading error message.** When validation fails it must blame the wrong field. The bug
 *      being investigated is not "submit is disabled", it is "the reason submit is disabled is not
 *      where the UI says it is". That gap is what makes the timeline necessary.
 *   3. **Nothing in the DOM names the bug.** No `data-bug`, no console message, no comment in the
 *      rendered markup. The recording captures the DOM; anything written there hands the agent the
 *      answer and makes the demo a re-enactment.
 *
 * TODO(vicko), Day 5:
 *   - the seven fields, each with an id, and a submit button disabled while validation fails
 *   - a `province` select populated from a stubbed `/api/provinces` that resolves 200 with `[]` when
 *     the empty-province bug is armed
 *   - the misleading error attached to `#postcode` rather than `#province`
 *   - the overlay bug: a promo banner over `#pay` at a higher z-index and near-zero opacity
 *   - the race bug: read options once on first render and never re-read them
 *   - a recorder control that is visible while developing and hidden in the recording itself (it must
 *     not appear in the captured DOM — an agent that finds a "Download recording" button in the replay
 *     will reason about it)
 */
export default function CheckoutPage() {
  const [bug, setBug] = useState<Bug | null>(null)

  useEffect(() => {
    setBug(activeBug(window.location.search))
  }, [])

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-xl font-semibold">Checkout</h1>
      <p className="mt-2 text-sm text-gray-600">Placeholder form — see the TODO in this file.</p>

      {/*
        Development-only banner so whoever is recording knows which bug is armed. It must not be in the
        DOM during a take: gate it on process.env.NODE_ENV before recording anything for real.
      */}
      {bug && process.env.NODE_ENV === 'development' ? (
        <p className="mt-6 border border-dashed border-gray-300 p-2 text-xs text-gray-500">
          armed: {BUG_SPECS[bug].label}
        </p>
      ) : null}
    </main>
  )
}
