import { beforeEach, describe, expect, it } from 'vitest'
import { findCandidates, stableSelectorFor } from './find-element'

/**
 * Tests for the two pure functions `find_element` had to grow its own, because there is no
 * `lib/dom/find-element.ts` to call. They are here rather than in `lib/` for the same reason the code
 * is — see the note at the top of find-element.ts — and they should move with it.
 *
 * The invariant worth testing is narrow and load-bearing: **the selector this hands the agent must
 * resolve to the same element later, at a different timestamp.** That rules out positional steps, which
 * are unique now and wrong after one insertion, so every case below round-trips the selector through
 * `querySelector` and the positional check is asserted globally rather than case by case.
 */

const POSITIONAL = /nth-child|nth-of-type|first-child|last-child|nth-last/

function markup(html: string): void {
  document.body.innerHTML = html
}

describe('stableSelectorFor', () => {
  beforeEach(() => {
    markup('')
  })

  it('prefers an id, written as #id', () => {
    markup('<form id="checkout"><select name="province"></select></form>')
    const form = document.querySelector('form')
    expect(form).not.toBeNull()
    expect(stableSelectorFor(form as Element, document)).toEqual({ selector: '#checkout', unique: true })
  })

  it('writes an id that is not a plain identifier as [id="..."], which needs no escaping', () => {
    markup('<div id="react:r1"><button>Pay</button></div>')
    const div = document.querySelector('div')
    const result = stableSelectorFor(div as Element, document)
    expect(result.selector).toBe('[id="react:r1"]')
    expect(document.querySelector(result.selector)).toBe(div)
  })

  it('falls back to data-testid, then to name', () => {
    markup(`
      <div data-testid="province-field">
        <label>Province</label>
      </div>
      <input name="card" />
    `)
    const field = document.querySelector('[data-testid=province-field]')
    const card = document.querySelector('input')
    expect(stableSelectorFor(field as Element, document).selector).toBe('div[data-testid="province-field"]')
    expect(stableSelectorFor(card as Element, document).selector).toBe('input[name="card"]')
  })

  it('separates a radio group by name plus type rather than by position', () => {
    markup(`
      <form id="ship">
        <input name="speed" type="radio" value="slow" />
        <input name="speed" type="checkbox" />
      </form>
    `)
    const checkbox = document.querySelector('input[type=checkbox]')
    const result = stableSelectorFor(checkbox as Element, document)
    expect(result).toEqual({ selector: 'input[name="speed"][type="checkbox"]', unique: true })
    expect(document.querySelector(result.selector)).toBe(checkbox)
  })

  it('anchors on the nearest id with a descendant combinator, so a new wrapper cannot break it', () => {
    markup(`
      <form id="checkout">
        <div class="row"><div class="col"><button type="submit">Pay</button></div></div>
      </form>
      <button type="submit">Other</button>
    `)
    const button = document.querySelector('#checkout button')
    const result = stableSelectorFor(button as Element, document)
    expect(result).toEqual({ selector: '#checkout button[type="submit"]', unique: true })

    // The point of the descendant combinator: another wrapper appears, the selector still resolves.
    const inserted = document.createElement('div')
    const row = document.querySelector('#checkout .row')
    const col = document.querySelector('#checkout .col')
    inserted.appendChild(col as Element)
    row?.appendChild(inserted)
    expect(document.querySelector(result.selector)).toBe(button)
  })

  it('reports unique: false instead of inventing a positional selector for identical siblings', () => {
    markup('<ul id="provinces"><li>Alpha</li><li>Beta</li><li>Gamma</li></ul>')
    const second = document.querySelectorAll('li')[1]
    const result = stableSelectorFor(second as Element, document)
    expect(result.unique).toBe(false)
    expect(result.selector).not.toMatch(POSITIONAL)
    // Honest ambiguity: it matches the element, among others.
    expect(Array.from(document.querySelectorAll(result.selector))).toContain(second)
  })

  it('skips an attribute whose value cannot be written into a selector safely', () => {
    markup('<div id="wrap"><button aria-label=\'say "hi"\'>Hi</button></div>')
    const button = document.querySelector('button')
    const result = stableSelectorFor(button as Element, document)
    expect(result.selector).not.toContain('"hi"')
    expect(document.querySelector(result.selector)).toBe(button)
  })

  it('never returns a positional selector, and round-trips to the same element when unique', () => {
    markup(`
      <main>
        <form id="checkout">
          <input name="email" type="email" value="ana@example.com" />
          <select name="province" required><option>A</option></select>
          <button type="submit" disabled>Pay</button>
          <div class="error" role="alert">Province is required</div>
        </form>
        <nav><a href="/help">Help</a><a href="/home">Home</a></nav>
      </main>
    `)

    for (const element of Array.from(document.querySelectorAll('main *'))) {
      const result = stableSelectorFor(element, document)
      expect(result.selector, result.selector).not.toMatch(POSITIONAL)
      if (result.unique) {
        expect(document.querySelector(result.selector), result.selector).toBe(element)
      }
    }
  })
})

describe('findCandidates', () => {
  beforeEach(() => {
    markup('')
  })

  it('matches text case-insensitively and keeps only the innermost match', () => {
    markup(`
      <form id="checkout">
        <div class="row"><button type="submit">Pay now</button></div>
      </form>
    `)
    const found = findCandidates(document, { text: 'pay' })
    expect(found).toHaveLength(1)
    expect(found[0]?.tagName).toBe('BUTTON')
  })

  it('matches a role against both the attribute and the implicit role of the tag', () => {
    markup(`
      <button>Real button</button>
      <div role="button">Fake button</div>
      <select name="province"></select>
    `)
    expect(findCandidates(document, { role: 'button' })).toHaveLength(2)
    expect(findCandidates(document, { role: 'combobox' }).map((element) => element.tagName)).toEqual(['SELECT'])
  })

  it('treats selector plus text as "and", not "or"', () => {
    markup(`
      <button type="submit">Pay</button>
      <button type="button">Cancel</button>
    `)
    const found = findCandidates(document, { selector: 'button', text: 'cancel' })
    expect(found.map((element) => element.getAttribute('type'))).toEqual(['button'])
  })

  it('returns nothing for a malformed selector rather than throwing out of the tool', () => {
    markup('<button>Pay</button>')
    expect(findCandidates(document, { selector: 'button[' })).toEqual([])
  })

  it('never offers the document scaffolding as a match', () => {
    markup('<p>Province is required</p>')
    const found = findCandidates(document, { text: 'province' })
    expect(found.map((element) => element.tagName)).toEqual(['P'])
  })
})
