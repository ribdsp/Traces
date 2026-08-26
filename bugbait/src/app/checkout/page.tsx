'use client'

import { useEffect, useRef, useState } from 'react'
import {
  armScenario,
  BUG_SPECS,
  MISLEADING_POSTCODE_ERROR,
  PROMO_DELAY_MS,
  SCENARIO_HEADER,
  type Bug,
} from '@/lib/bugs'
import { currentRecorder } from '@/lib/record'
import { RecorderPanel } from '@/components/recorder-panel'

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
 * Day 5 (vicko) — implemented. Three notes on how each bug is kept invisible in the finished DOM,
 * because that property is the argument of the whole project and the easiest thing to break by accident:
 *
 *   - **empty-province.** `/api/provinces` is requested the moment this page mounts and resolves 1.5s
 *     later — about 12s into a session that started in the cart. The payment section, and therefore the
 *     `#province` select, is not revealed until the shopper clicks Continue, around 28s. So the final
 *     DOM contains a select with zero options and an error blaming the postcode, and contains no trace
 *     whatsoever of a request sixteen seconds earlier that returned `200` with `[]`.
 *   - **race.** The city list is captured into state during the first render of this component and never
 *     re-read; the response, when it arrives, is written into a ref that nothing renders. The final DOM
 *     is an empty select — identical to a select whose request failed, whose request was never made, or
 *     which has no cities to show. Only the *ordering* separates those, and ordering is not a property
 *     of a DOM tree.
 *   - **overlay.** `#promo-strip` covers `#pay` at a higher stacking level and 3% opacity: a fade-in
 *     that never completed. The button is present, enabled, and passes every DOM assertion an agent can
 *     make about it. Nothing is wrong with either element on its own — the bug exists only in the
 *     relationship between two boxes, which is what `measure_layout` is for. The opacity is low enough
 *     that a human watching the replay cannot see it either, so this is not a bug `ask_human_visual`
 *     can solve.
 *
 * The disclosure is progressive rather than a wizard, deliberately: nothing ever unmounts, so
 * `#postcode` and `#name` keep matching for the entire recording and a bisect probe on them never has
 * to report `elementMissing` for a reason that is an artefact of the fixture.
 */

type Province = { code: string; name: string }
type City = { id: string; name: string }

/** rrweb's own input masking means these are only ever recorded as lengths. See lib/record.ts. */
const CARD_DIGITS = 16
const POSTCODE_PATTERN = /^\d{5}$/

function isProvinceList(value: unknown): value is Province[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { code?: unknown }).code === 'string' &&
        typeof (item as { name?: unknown }).name === 'string',
    )
  )
}

function isCityList(value: unknown): value is City[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { id?: unknown }).id === 'string' &&
        typeof (item as { name?: unknown }).name === 'string',
    )
  )
}

export default function CheckoutPage() {
  const [bug, setBug] = useState<Bug | null>(null)

  const [fullName, setFullName] = useState('')
  const [address, setAddress] = useState('')
  const [postcode, setPostcode] = useState('')
  const [province, setProvince] = useState('')
  const [city, setCity] = useState('')
  const [card, setCard] = useState('')

  const [provinces, setProvinces] = useState<Province[]>([])
  const [cities, setCities] = useState<City[]>([])

  const [paymentRevealed, setPaymentRevealed] = useState(false)
  const [promoVisible, setPromoVisible] = useState(false)
  const [paying, setPaying] = useState(false)

  /**
   * The race bug, in three lines.
   *
   * `citiesArrived` is written by the fetch and read by nobody; `citiesReadOnce` is the value the select
   * renders, captured from that ref during the first render, when it is still empty. Writing to a ref
   * does not schedule a render, and even the renders caused by later typing re-read `citiesReadOnce` —
   * which is state, and therefore still the empty array it was initialised with. This is the ordinary
   * shape of a real stale-initial-state bug, not a contrivance: it looks correct at the call site.
   */
  const citiesArrived = useRef<City[]>([])
  const [citiesReadOnce] = useState<City[]>(() => citiesArrived.current)

  const reportedBlocked = useRef(false)

  // One effect, on mount, in this order: arm the scenario (which also strips `?bug=` out of the address
  // bar before rrweb snapshots it), timestamp the navigation, then start the request that will matter in
  // sixteen seconds.
  useEffect(() => {
    const armed = armScenario()
    setBug(armed)
    currentRecorder()?.markNavigation()

    let cancelled = false
    const headers: Record<string, string> = armed ? { [SCENARIO_HEADER]: armed } : {}

    void fetch('/api/provinces?country=ID', { headers })
      .then((response) => response.json() as Promise<unknown>)
      .then((body) => {
        if (cancelled) return
        // No empty-state handling, and that is the bug: an empty list is accepted as the truth about
        // this country's provinces, so the select renders zero options and says nothing about why.
        setProvinces(isProvinceList(body) ? body : [])
      })
      .catch(() => {
        if (!cancelled) setProvinces([])
      })

    return () => {
      cancelled = true
    }
  }, [])

  // Cities load when a province is chosen. The select is already mounted by then — that is the ordering
  // the race scenario depends on, and it is also just how a dependent dropdown normally works.
  useEffect(() => {
    if (province === '') return

    let cancelled = false
    void fetch(`/api/cities?province=${encodeURIComponent(province)}`)
      .then((response) => response.json() as Promise<unknown>)
      .then((body) => {
        if (cancelled) return
        const list = isCityList(body) ? body : []
        citiesArrived.current = list
        setCities(list)
      })
      .catch(() => {
        if (!cancelled) setCities([])
      })

    return () => {
      cancelled = true
    }
  }, [province])

  useEffect(() => {
    if (bug !== 'overlay' || !paymentRevealed) return
    const timer = setTimeout(() => setPromoVisible(true), PROMO_DELAY_MS)
    return () => clearTimeout(timer)
  }, [bug, paymentRevealed])

  const cityOptions = bug === 'race' ? citiesReadOnce : cities

  const invalid = {
    fullName: fullName.trim() === '',
    address: address.trim() === '',
    postcode: !POSTCODE_PATTERN.test(postcode),
    province: province === '',
    city: city === '',
    card: card.replace(/\D/g, '').length !== CARD_DIGITS,
  }
  const blocked = Object.values(invalid).some(Boolean)

  // Shown once the shopper has done everything the form lets them do — a complete card number is the
  // signal that they are finished, so live validation does not flicker while they are still typing it.
  // It names the postcode, which is valid; the field actually blocking submission is left looking
  // untouched and unremarkable.
  const showBlockingError = paymentRevealed && !invalid.card && blocked

  useEffect(() => {
    if (!showBlockingError || reportedBlocked.current) return
    reportedBlocked.current = true
    // The console line says exactly what the UI says, and is wrong in exactly the same way. Logging the
    // real mechanism here would put the answer in the recording in plain text and reduce the whole
    // investigation to reading it out.
    console.error('[checkout] address verification failed (postcode)')
  }, [showBlockingError])

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-xl font-semibold">Checkout</h1>

      <form
        id="checkout"
        className="mt-6 space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          setPaying(true)
        }}
      >
        <section className="space-y-4">
          <h2 className="text-sm font-medium">Delivery address</h2>

          <div>
            <label htmlFor="name" className="block text-sm text-gray-700">
              Full name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              className="mt-1 w-full border border-gray-300 px-2 py-1 text-sm"
            />
          </div>

          <div>
            <label htmlFor="address" className="block text-sm text-gray-700">
              Street address
            </label>
            <input
              id="address"
              name="address"
              type="text"
              autoComplete="street-address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              className="mt-1 w-full border border-gray-300 px-2 py-1 text-sm"
            />
          </div>

          <div>
            <label htmlFor="postcode" className="block text-sm text-gray-700">
              Postcode
            </label>
            <input
              id="postcode"
              name="postcode"
              type="text"
              inputMode="numeric"
              autoComplete="postal-code"
              value={postcode}
              onChange={(event) => setPostcode(event.target.value)}
              aria-invalid={showBlockingError ? 'true' : undefined}
              aria-describedby={showBlockingError ? 'postcode-error' : undefined}
              className="mt-1 w-full border border-gray-300 px-2 py-1 text-sm"
            />
            {showBlockingError ? (
              <p id="postcode-error" className="mt-1 text-xs text-red-700">
                {MISLEADING_POSTCODE_ERROR}
              </p>
            ) : null}
          </div>

          {!paymentRevealed ? (
            <button
              type="button"
              id="continue"
              onClick={() => setPaymentRevealed(true)}
              className="border border-gray-900 px-3 py-1 text-sm"
            >
              Continue
            </button>
          ) : null}
        </section>

        {paymentRevealed ? (
          <section className="space-y-4 border-t border-gray-200 pt-4">
            <h2 className="text-sm font-medium">Region and payment</h2>

            <div>
              <label htmlFor="province" className="block text-sm text-gray-700">
                Province
              </label>
              <select
                id="province"
                name="province"
                value={province}
                onChange={(event) => {
                  setProvince(event.target.value)
                  setCity('')
                }}
                className="mt-1 w-full border border-gray-300 px-2 py-1 text-sm"
              >
                {/*
                  The placeholder belongs to the list, so an empty list is an empty select — literally
                  zero options, not one. That is what makes the symptom `optionCount: 0`, which is the
                  predicate docs/tools.md advertises and the number docs/architecture.md pins, rather
                  than a lone placeholder that a bisect would have to be told to expect.
                */}
                {provinces.length > 0 ? <option value="">Select a province</option> : null}
                {provinces.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="city" className="block text-sm text-gray-700">
                City
              </label>
              <select
                id="city"
                name="city"
                value={city}
                onChange={(event) => setCity(event.target.value)}
                className="mt-1 w-full border border-gray-300 px-2 py-1 text-sm"
              >
                {cityOptions.length > 0 ? <option value="">Select a city</option> : null}
                {cityOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="card" className="block text-sm text-gray-700">
                Card number
              </label>
              <input
                id="card"
                name="card"
                type="text"
                inputMode="numeric"
                autoComplete="cc-number"
                value={card}
                onChange={(event) => setCard(event.target.value)}
                className="mt-1 w-full border border-gray-300 px-2 py-1 text-sm"
              />
            </div>

            {/*
              `relative` with an absolutely-positioned sibling: the promo strip below inherits exactly
              this box, which is why it covers the button and nothing else.
            */}
            <div className="relative inline-block">
              <button
                type="submit"
                id="pay"
                disabled={blocked}
                className="border border-gray-900 bg-gray-900 px-4 py-2 text-sm text-white disabled:border-gray-300 disabled:bg-gray-200 disabled:text-gray-500"
              >
                {paying ? 'Processing…' : 'Pay now'}
              </button>
              {promoVisible ? (
                <div id="promo-strip" className="promo-strip">
                  Free shipping this week
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
      </form>

      {/*
        Development-only banner so whoever is recording knows which bug is armed. It must not be in the
        DOM during a take: gate it on process.env.NODE_ENV before recording anything for real.
      */}
      {bug && process.env.NODE_ENV === 'development' ? (
        <p className="mt-6 border border-dashed border-gray-300 p-2 text-xs text-gray-500">
          armed: {BUG_SPECS[bug].label}
        </p>
      ) : null}

      <RecorderPanel armed={bug} />
    </main>
  )
}
