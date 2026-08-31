import { describe, expect, it } from 'vitest'
import { MAX_CHARS, MAX_LINES, compressDom } from './compress-dom'

/**
 * These tests fail until compressDom exists. That is intentional — this is the RED half of the
 * cycle, and the budget assertions are the reason this module is tested at all: a budget nobody
 * checks erodes within a week, and its erosion is invisible.
 */

/** A checkout form roughly the size of bugbait's, wrapped in the layout noise a real app has. */
function buildFormFixture(): Element {
  const root = document.createElement('div')
  root.innerHTML = `
    <div class="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <div class="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 class="text-lg font-semibold tracking-tight">Shipping address</h2>
        <form id="checkout">
          <input name="fullName" type="text" value="Sample Name" placeholder="Full name" />
          <input name="email" type="email" value="" aria-invalid="true" />
          <select name="province"></select>
          <select name="city"><option>Bandung</option><option>Bogor</option></select>
          <textarea name="notes"></textarea>
          <button type="submit" disabled>Pay now</button>
        </form>
      </div>
    </div>
  `
  return root
}

/** Deep, wide, and entirely uninteresting: the shape that blows a budget if depth is unbounded. */
function buildDeepFixture(): Element {
  const root = document.createElement('div')
  let cursor: Element = root
  for (let depth = 0; depth < 40; depth += 1) {
    const wrapper = document.createElement('div')
    wrapper.className = 'flex flex-col items-center justify-between gap-2 p-4'
    for (let sibling = 0; sibling < 10; sibling += 1) {
      const span = document.createElement('span')
      span.textContent = `decorative ${depth}-${sibling}`
      wrapper.appendChild(span)
    }
    cursor.appendChild(wrapper)
    cursor = wrapper
  }
  const button = document.createElement('button')
  button.textContent = 'Buried but interactive'
  cursor.appendChild(button)
  return root
}

describe('compressDom — budget', () => {
  it('stays within the line budget on a realistic form', () => {
    const result = compressDom({ root: buildFormFixture(), atMs: 0 })
    expect(result.lineCount).toBeLessThanOrEqual(MAX_LINES)
  })

  it('stays within the character budget on a realistic form', () => {
    const result = compressDom({ root: buildFormFixture(), atMs: 0 })
    expect(result.charCount).toBeLessThanOrEqual(MAX_CHARS)
  })

  it('stays within budget on a pathologically deep tree, and says it truncated', () => {
    const result = compressDom({ root: buildDeepFixture(), atMs: 0 })
    expect(result.charCount).toBeLessThanOrEqual(MAX_CHARS)
    expect(result.truncated).toBe(true)
  })

  it('reports the source size, so the compression ratio is measured rather than claimed', () => {
    const root = buildFormFixture()
    const result = compressDom({ root, atMs: 0 })
    expect(result.sourceCharCount).toBe(root.outerHTML.length)
    expect(result.charCount).toBeLessThan(result.sourceCharCount)
  })
})

describe('compressDom — what survives', () => {
  it('keeps every interactive element', () => {
    const { dom } = compressDom({ root: buildFormFixture(), atMs: 0 })
    for (const name of ['fullName', 'email', 'province', 'city', 'notes']) {
      expect(dom).toContain(name)
    }
    expect(dom).toContain('button')
  })

  it('annotates an empty select with its option count — this is the empty-province bug', () => {
    const { dom } = compressDom({ root: buildFormFixture(), atMs: 0 })
    expect(dom).toMatch(/province.*empty options: 0/s)
  })

  it('marks disabled state in a form a model reads reliably', () => {
    const { dom } = compressDom({ root: buildFormFixture(), atMs: 0 })
    expect(dom).toContain('[DISABLED]')
  })

  it('keeps aria-invalid, because it is the page telling us what it already knows', () => {
    const { dom } = compressDom({ root: buildFormFixture(), atMs: 0 })
    expect(dom).toContain('aria-invalid')
  })

  it('drops utility classes and decorative wrappers', () => {
    const { dom } = compressDom({ root: buildFormFixture(), atMs: 0 })
    expect(dom).not.toContain('mx-auto')
    expect(dom).not.toContain('shadow-sm')
  })

  it('finds an interactive element buried under forty layout wrappers', () => {
    const { dom } = compressDom({ root: buildDeepFixture(), atMs: 0 })
    expect(dom).toContain('Buried but interactive')
  })
})
