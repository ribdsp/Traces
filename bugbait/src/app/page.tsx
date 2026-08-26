import Link from 'next/link'
import { BUGS, BUG_SPECS } from '@/lib/bugs'

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
 * TODO(vicko), Day 5:
 *   - two or three line items with quantity steppers and a total that updates
 *   - "Continue to checkout" carries the `?bug=` parameter through, so the whole session is one flow
 *   - the recorder starts on this page, not on /checkout — see lib/record.ts
 */
export default function CartPage() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-xl font-semibold">Your cart</h1>
      <p className="mt-2 text-sm text-gray-600">Placeholder — see the TODO in this file.</p>

      <h2 className="mt-8 text-sm font-medium">Recording scenarios</h2>
      <ul className="mt-2 space-y-2">
        {BUGS.map((bug) => (
          <li key={bug} className="text-sm">
            <Link href={`/checkout?bug=${bug}`} className="underline">
              {BUG_SPECS[bug].label}
            </Link>
            <p className="text-xs text-gray-500">{BUG_SPECS[bug].symptom}</p>
          </li>
        ))}
      </ul>
    </main>
  )
}
