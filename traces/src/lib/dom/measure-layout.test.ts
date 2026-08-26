import { afterEach, describe, expect, it } from 'vitest'
import { measureLayout } from './measure-layout'

/**
 * jsdom does not implement layout: `getBoundingClientRect()` returns an all-zero rect for every
 * element, always, regardless of markup or styles. So no test here builds real markup and trusts the
 * browser to lay it out — that would only prove jsdom returns zeros.
 *
 * Two kinds of assertion, kept deliberately separate:
 *
 * - **Injected geometry.** Tests under "geometry and stacking" and "overlaps" call `place()`, which
 *   overwrites `getBoundingClientRect` on a specific element with a hand-built rect. The numbers under
 *   test there are *chosen*, not measured — they exercise measureLayout's rounding and intersection
 *   math, nothing about real browser layout.
 * - **Real jsdom behaviour.** Tests under "computed style" set inline `style` attributes and read them
 *   back through `getComputedStyle`, which jsdom does implement for explicit inline declarations. No
 *   rect is injected in that group — those tests only look at `visibility`, `display` and `zIndex`.
 *   One genuine jsdom quirk surfaced here: `getComputedStyle().zIndex` on an unset element returns
 *   `''`, not the CSS initial value `'auto'` a real browser gives. measureLayout normalizes that in
 *   `normalizeZIndex` — the z-index test below asserts the normalized, contract-correct value.
 *
 * Every test says in its own name or a comment which kind it is, so a stub can't be mistaken for a
 * measurement later.
 */

function fakeRect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    toJSON() {
      return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height }
    },
  }
}

/** Injected geometry — see the file header. Not a measurement of anything real. */
function place(element: Element, rect: { x: number; y: number; width: number; height: number }): void {
  element.getBoundingClientRect = () => fakeRect(rect.x, rect.y, rect.width, rect.height)
}

/** A fresh host attached to the live document, so `document.querySelectorAll` can actually find it. */
function mount(html: string): Element {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  return host
}

function findBox(result: ReturnType<typeof measureLayout>, selector: string) {
  const box = result.boxes.find((candidate) => candidate.selector === selector)
  if (!box) throw new Error(`no box found for selector '${selector}' among: ${result.boxes.map((b) => b.selector).join(', ')}`)
  return box
}

afterEach(() => {
  // Fixtures are appended straight to document.body (querySelectorAll needs them attached), so they
  // have to be cleaned up between tests or one test's elements would leak into the next test's query.
  document.body.innerHTML = ''
})

describe('measureLayout — geometry and stacking (injected geometry)', () => {
  it('reports the atMs it was asked about, unchanged', () => {
    const host = mount('<button id="pay">Pay</button>')
    const button = host.querySelector('#pay')
    if (!button) throw new Error('fixture produced no element')
    place(button, { x: 0, y: 0, width: 10, height: 10 })

    const result = measureLayout(document, ['#pay'], 4200)
    expect(result.atMs).toBe(4200)
  })

  it('rounds sub-pixel geometry, so a model never sees noise it will over-interpret', () => {
    const host = mount('<button id="pay">Pay</button>')
    const button = host.querySelector('#pay')
    if (!button) throw new Error('fixture produced no element')
    place(button, { x: 10.4, y: 19.6, width: 100.5, height: 39.51 })

    const result = measureLayout(document, ['#pay'], 0)
    const box = findBox(result, '#pay')
    expect(box.x).toBe(10)
    expect(box.y).toBe(20)
    expect(box.width).toBe(101)
    expect(box.height).toBe(40)
  })

  it('keeps a zero-area box in the result — a collapsed element is still worth reporting', () => {
    const host = mount('<div id="ghost"></div>')
    const ghost = host.querySelector('#ghost')
    if (!ghost) throw new Error('fixture produced no element')
    place(ghost, { x: 5, y: 5, width: 0, height: 0 })

    const result = measureLayout(document, ['#ghost'], 0)
    const box = findBox(result, '#ghost')
    expect(box.width).toBe(0)
    expect(box.height).toBe(0)
  })
})

describe('measureLayout — computed style (real jsdom behaviour, no injected geometry)', () => {
  it('reports visible for an element with no visibility override', () => {
    mount('<div id="plain">hello</div>')
    const result = measureLayout(document, ['#plain'], 0)
    expect(findBox(result, '#plain').visibility).toBe('visible')
  })

  it('reports hidden for visibility: hidden', () => {
    mount('<div id="hidden-thing" style="visibility: hidden;"></div>')
    const result = measureLayout(document, ['#hidden-thing'], 0)
    expect(findBox(result, '#hidden-thing').visibility).toBe('hidden')
  })

  it('folds visibility: collapse into hidden — the contract has no third state', () => {
    mount('<div id="collapsed" style="visibility: collapse;"></div>')
    const result = measureLayout(document, ['#collapsed'], 0)
    expect(findBox(result, '#collapsed').visibility).toBe('hidden')
  })

  it('passes computed display through verbatim', () => {
    mount('<div id="flexy" style="display: flex;"></div>')
    const result = measureLayout(document, ['#flexy'], 0)
    expect(findBox(result, '#flexy').display).toBe('flex')
  })

  it('passes computed z-index through, normalizing jsdom\'s "" for unset into "auto"', () => {
    mount(`
      <div id="auto-thing"></div>
      <div id="stacked" style="position: relative; z-index: 7;"></div>
    `)
    const result = measureLayout(document, ['#auto-thing', '#stacked'], 0)
    expect(findBox(result, '#auto-thing').zIndex).toBe('auto')
    expect(findBox(result, '#stacked').zIndex).toBe('7')
  })
})

describe('measureLayout — overlaps (injected geometry)', () => {
  it('reports a pair whose boxes intersect and whose z-indices differ, above the higher one', () => {
    const host = mount(`
      <button id="submit" style="position: relative; z-index: 1;">Pay</button>
      <div id="overlay" style="position: absolute; z-index: 5;"></div>
    `)
    const submit = host.querySelector('#submit')
    const overlay = host.querySelector('#overlay')
    if (!submit || !overlay) throw new Error('fixture produced no element')
    place(submit, { x: 0, y: 0, width: 100, height: 40 })
    place(overlay, { x: 50, y: 10, width: 100, height: 40 })

    const result = measureLayout(document, ['#submit', '#overlay'], 0)
    expect(result.overlaps).toEqual([{ above: '#overlay', below: '#submit', overlapArea: 50 * 30 }])
  })

  it('does not report a pair with equal explicit z-index', () => {
    const host = mount(`
      <div id="a" style="position: relative; z-index: 3;"></div>
      <div id="b" style="position: relative; z-index: 3;"></div>
    `)
    const a = host.querySelector('#a')
    const b = host.querySelector('#b')
    if (!a || !b) throw new Error('fixture produced no element')
    place(a, { x: 0, y: 0, width: 100, height: 100 })
    place(b, { x: 10, y: 10, width: 100, height: 100 })

    const result = measureLayout(document, ['#a', '#b'], 0)
    expect(result.overlaps).toEqual([])
  })

  it('does not report a pair where both z-indices are "auto" — no ordering signal between them', () => {
    const host = mount(`
      <div id="a"></div>
      <div id="b"></div>
    `)
    const a = host.querySelector('#a')
    const b = host.querySelector('#b')
    if (!a || !b) throw new Error('fixture produced no element')
    place(a, { x: 0, y: 0, width: 100, height: 100 })
    place(b, { x: 10, y: 10, width: 100, height: 100 })

    const result = measureLayout(document, ['#a', '#b'], 0)
    expect(result.overlaps).toEqual([])
  })

  it('treats an explicit z-index of 0 the same as "auto"', () => {
    const host = mount(`
      <div id="a" style="position: relative; z-index: 0;"></div>
      <div id="b"></div>
    `)
    const a = host.querySelector('#a')
    const b = host.querySelector('#b')
    if (!a || !b) throw new Error('fixture produced no element')
    place(a, { x: 0, y: 0, width: 100, height: 100 })
    place(b, { x: 10, y: 10, width: 100, height: 100 })

    const result = measureLayout(document, ['#a', '#b'], 0)
    expect(result.overlaps).toEqual([])
  })

  it('orders an explicit z-index above "auto"', () => {
    const host = mount(`
      <div id="a"></div>
      <div id="b" style="position: relative; z-index: -1;"></div>
    `)
    const a = host.querySelector('#a')
    const b = host.querySelector('#b')
    if (!a || !b) throw new Error('fixture produced no element')
    place(a, { x: 0, y: 0, width: 100, height: 100 })
    place(b, { x: 10, y: 10, width: 100, height: 100 })

    const result = measureLayout(document, ['#a', '#b'], 0)
    expect(result.overlaps).toEqual([{ above: '#a', below: '#b', overlapArea: 90 * 90 }])
  })

  it('never reports an overlap for a zero-area box, even when its coordinates coincide with another box', () => {
    const host = mount(`
      <div id="real" style="position: relative; z-index: 1;"></div>
      <div id="collapsed-thing" style="position: relative; z-index: 9;"></div>
    `)
    const real = host.querySelector('#real')
    const collapsedThing = host.querySelector('#collapsed-thing')
    if (!real || !collapsedThing) throw new Error('fixture produced no element')
    place(real, { x: 0, y: 0, width: 100, height: 100 })
    place(collapsedThing, { x: 20, y: 20, width: 0, height: 0 })

    const result = measureLayout(document, ['#real', '#collapsed-thing'], 0)
    expect(result.overlaps).toEqual([])
  })

  it('does not intersect two boxes that do not touch', () => {
    const host = mount(`
      <div id="left" style="position: relative; z-index: 1;"></div>
      <div id="right" style="position: relative; z-index: 2;"></div>
    `)
    const left = host.querySelector('#left')
    const right = host.querySelector('#right')
    if (!left || !right) throw new Error('fixture produced no element')
    place(left, { x: 0, y: 0, width: 10, height: 10 })
    place(right, { x: 100, y: 100, width: 10, height: 10 })

    const result = measureLayout(document, ['#left', '#right'], 0)
    expect(result.overlaps).toEqual([])
  })
})

describe('measureLayout — selector resolution', () => {
  it('skips a selector that matches nothing, without throwing', () => {
    mount('<button id="pay">Pay</button>')
    const result = measureLayout(document, ['#pay', '.does-not-exist'], 0)
    expect(result.boxes.map((box) => box.selector)).toEqual(['#pay'])
  })

  it('keeps the plain selector when it matches exactly one element', () => {
    mount('<button id="pay">Pay</button>')
    const result = measureLayout(document, ['#pay'], 0)
    expect(result.boxes).toHaveLength(1)
    expect(result.boxes[0]?.selector).toBe('#pay')
  })

  it('disambiguates a selector that matches several elements, one box per match', () => {
    mount(`
      <div class="badge">One</div>
      <div class="badge">Two</div>
      <div class="badge">Three</div>
    `)
    const result = measureLayout(document, ['.badge'], 0)
    expect(result.boxes.map((box) => box.selector)).toEqual([
      '.badge [match 1/3]',
      '.badge [match 2/3]',
      '.badge [match 3/3]',
    ])
  })

  it('rejects a malformed selector with a readable error, not a raw DOM exception', () => {
    mount('<button id="pay">Pay</button>')
    expect(() => measureLayout(document, ['#pay ['], 0)).toThrow(/not a valid CSS selector/)
    expect(() => measureLayout(document, ['#pay ['], 0)).toThrow(/#pay \[/)
  })
})
