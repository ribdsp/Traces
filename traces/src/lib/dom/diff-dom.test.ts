import { describe, expect, it } from 'vitest'
import { MAX_CHANGES, diffDom } from './diff-dom'

/**
 * Two documents standing in for two moments of one recording. The caller positions the replay and
 * hands `diffDom` the resulting documents, so the tests can do the same thing without rrweb.
 */
function documentFrom(markup: string): Document {
  const created = document.implementation.createHTMLDocument('fixture')
  created.body.innerHTML = markup
  return created
}

const CHECKOUT = `
  <div class="mx-auto flex max-w-3xl gap-6 p-8">
    <form id="checkout">
      <input name="email" type="email" value="ana@example.com" />
      <select name="province"><option>Jawa Barat</option></select>
      <button type="submit">Pay now</button>
      <div class="error"></div>
    </form>
  </div>
`

describe('diffDom', () => {
  it('reports nothing when the two moments are identical', () => {
    const result = diffDom({ document: documentFrom(CHECKOUT), atMs: 100 }, { document: documentFrom(CHECKOUT), atMs: 900 })

    expect(result.changes).toEqual([])
    expect(result.truncated).toBe(false)
  })

  it('carries both timestamps through, so the agent knows what window it asked about', () => {
    const result = diffDom({ document: documentFrom(CHECKOUT), atMs: 100 }, { document: documentFrom(CHECKOUT), atMs: 900 })

    expect(result.fromMs).toBe(100)
    expect(result.toMs).toBe(900)
  })

  it('reports an attribute that appeared, naming the attribute on both sides', () => {
    const after = `
      <div class="mx-auto flex max-w-3xl gap-6 p-8">
        <form id="checkout">
          <input name="email" type="email" value="ana@example.com" />
          <select name="province"><option>Jawa Barat</option></select>
          <button type="submit" disabled>Pay now</button>
          <div class="error"></div>
        </form>
      </div>
    `
    const result = diffDom({ document: documentFrom(CHECKOUT), atMs: 0 }, { document: documentFrom(after), atMs: 1000 })
    const change = result.changes.find((entry) => entry.kind === 'attributeChanged')

    expect(change).toBeDefined()
    expect(change?.selector).toContain('button')
    expect(change?.before).toContain('disabled')
    expect(change?.after).toContain('disabled')
  })

  it('reports an element that appeared as added', () => {
    const after = `
      <div class="mx-auto flex max-w-3xl gap-6 p-8">
        <form id="checkout">
          <input name="email" type="email" value="ana@example.com" />
          <select name="province"><option>Jawa Barat</option></select>
          <button type="submit">Pay now</button>
          <div class="error"></div>
          <input name="coupon" type="text" value="" />
        </form>
      </div>
    `
    const result = diffDom({ document: documentFrom(CHECKOUT), atMs: 0 }, { document: documentFrom(after), atMs: 1000 })
    const added = result.changes.filter((entry) => entry.kind === 'added')

    expect(added).toHaveLength(1)
    expect(added[0]?.selector).toContain('coupon')
  })

  it('reports an element that vanished as removed', () => {
    const after = `
      <div class="mx-auto flex max-w-3xl gap-6 p-8">
        <form id="checkout">
          <input name="email" type="email" value="ana@example.com" />
          <button type="submit">Pay now</button>
          <div class="error"></div>
        </form>
      </div>
    `
    const result = diffDom({ document: documentFrom(CHECKOUT), atMs: 0 }, { document: documentFrom(after), atMs: 1000 })
    const removed = result.changes.filter((entry) => entry.kind === 'removed')

    expect(removed.some((entry) => entry.selector.includes('province'))).toBe(true)
  })

  it('reports changed text', () => {
    const after = `
      <div class="mx-auto flex max-w-3xl gap-6 p-8">
        <form id="checkout">
          <input name="email" type="email" value="ana@example.com" />
          <select name="province"><option>Jawa Barat</option></select>
          <button type="submit">Processing...</button>
          <div class="error"></div>
        </form>
      </div>
    `
    const result = diffDom({ document: documentFrom(CHECKOUT), atMs: 0 }, { document: documentFrom(after), atMs: 1000 })
    const change = result.changes.find((entry) => entry.kind === 'textChanged')

    expect(change?.before).toBe('Pay now')
    expect(change?.after).toBe('Processing...')
  })

  /** The reason this diffs compressed trees. A raw diff of a React app is mostly this. */
  it('ignores a class-only change, which is noise a model cannot act on', () => {
    const after = `
      <div class="flex gap-6 p-8 mx-auto max-w-3xl">
        <form id="checkout">
          <input name="email" type="email" value="ana@example.com" />
          <select name="province"><option>Jawa Barat</option></select>
          <button type="submit">Pay now</button>
          <div class="error"></div>
        </form>
      </div>
    `
    const result = diffDom({ document: documentFrom(CHECKOUT), atMs: 0 }, { document: documentFrom(after), atMs: 1000 })

    expect(result.changes).toEqual([])
  })

  it('emits selectors that actually resolve against the document they describe', () => {
    const after = `
      <div class="mx-auto flex max-w-3xl gap-6 p-8">
        <form id="checkout">
          <input name="email" type="email" value="budi@example.com" />
          <select name="province"><option>Jawa Barat</option></select>
          <button type="submit" disabled>Pay now</button>
          <div class="error">Province is required</div>
        </form>
      </div>
    `
    const afterDocument = documentFrom(after)
    const result = diffDom({ document: documentFrom(CHECKOUT), atMs: 0 }, { document: afterDocument, atMs: 1000 })

    expect(result.changes.length).toBeGreaterThan(0)
    for (const change of result.changes) {
      if (change.kind === 'removed') continue
      expect(afterDocument.querySelector(change.selector), `unresolvable: ${change.selector}`).not.toBeNull()
    }
  })

  it('distinguishes sibling radios that share a name, rather than collapsing them', () => {
    const before = `
      <form id="prefs">
        <input name="ship" type="radio" value="standard" checked />
        <input name="ship" type="radio" value="express" />
      </form>
    `
    const after = `
      <form id="prefs">
        <input name="ship" type="radio" value="standard" />
        <input name="ship" type="radio" value="express" checked />
      </form>
    `
    const result = diffDom({ document: documentFrom(before), atMs: 0 }, { document: documentFrom(after), atMs: 1000 })
    const selectors = new Set(result.changes.map((entry) => entry.selector))

    expect(result.changes.length).toBeGreaterThanOrEqual(2)
    expect(selectors.size).toBe(result.changes.length)
  })

  it('caps the list at MAX_CHANGES and says so', () => {
    const rows = (count: number, suffix: string): string =>
      Array.from({ length: count }, (_, index) => `<p>row ${index}${suffix}</p>`).join('')
    const result = diffDom(
      { document: documentFrom(`<div>${rows(50, '')}</div>`), atMs: 0 },
      { document: documentFrom(`<div>${rows(50, ' changed')}</div>`), atMs: 1000 },
    )

    expect(result.changes).toHaveLength(MAX_CHANGES)
    expect(result.truncated).toBe(true)
  })

  it('keeps an interactive change over a text change when the cap bites', () => {
    const noise = (suffix: string): string =>
      Array.from({ length: 60 }, (_, index) => `<p>row ${index}${suffix}</p>`).join('')
    const result = diffDom(
      { document: documentFrom(`<div>${noise('')}<button type="submit">Pay</button></div>`), atMs: 0 },
      { document: documentFrom(`<div>${noise(' changed')}<button type="submit" disabled>Pay</button></div>`), atMs: 1000 },
    )

    expect(result.truncated).toBe(true)
    expect(result.changes.some((entry) => entry.selector.includes('button'))).toBe(true)
  })
})
