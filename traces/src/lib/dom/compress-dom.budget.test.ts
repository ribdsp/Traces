import { describe, expect, it } from 'vitest'
import { MAX_CHARS, MAX_LINES, TRUNCATION_NOTE, compressDom } from './compress-dom'

/**
 * The budget as an invariant, on inputs chosen to break it.
 *
 * Separate from compress-dom.test.ts on purpose: that file is the original specification and is
 * red-on-purpose by design, so it is never edited. These cases were added afterwards, from a hole found
 * by reading the implementation rather than by a failing assertion — `value` and `href` had explicit
 * caps and every other whitelisted attribute did not, so one element with a long `aria-label` could
 * emit a single line over the whole character budget.
 */
function fixture(markup: string): Element {
  const created = document.implementation.createHTMLDocument('fixture')
  created.body.innerHTML = markup
  return created.body
}

describe('compressDom budget invariants', () => {
  it('stays inside the budget when one element carries several very long attributes', () => {
    const long = 'x'.repeat(4_000)
    const root = fixture(`
      <div id="${long}" aria-label="${long}" data-testid="${long}">
        <button type="submit">Pay now</button>
      </div>
    `)

    const result = compressDom({ root, atMs: 0 })

    expect(result.charCount).toBeLessThanOrEqual(MAX_CHARS)
    expect(result.lineCount).toBeLessThanOrEqual(MAX_LINES)
    expect(result.dom).not.toContain(long)
    // The button is what the agent is here for, and it survives.
    expect(result.dom).toContain('Pay now')
  })

  it('caps a long attribute value rather than emitting it whole', () => {
    const long = 'z'.repeat(500)
    const root = fixture(`<div><input name="email" type="email" placeholder="${long}" /></div>`)

    const result = compressDom({ root, atMs: 0 })

    expect(result.dom).not.toContain(long)
    expect(result.dom).toContain('placeholder=')
    expect(result.charCount).toBeLessThanOrEqual(MAX_CHARS)
  })

  it('holds the budget when long attributes and a crowd of candidates combine', () => {
    const label = 'w'.repeat(300)
    const rows = Array.from(
      { length: 80 },
      (_, index) => `<button type="button" aria-label="${label}">Row ${index}</button>`,
    ).join('')
    const root = fixture(`<div>${rows}</div>`)

    const result = compressDom({ root, atMs: 0 })

    expect(result.charCount).toBeLessThanOrEqual(MAX_CHARS)
    expect(result.lineCount).toBeLessThanOrEqual(MAX_LINES)
    expect(result.truncated).toBe(true)
    expect(result.dom).toContain(TRUNCATION_NOTE)
  })

  it('leaves a comfortably small tree untouched, so truncation stays meaningful', () => {
    const root = fixture(`<div><button type="submit" disabled>Pay now</button></div>`)

    const result = compressDom({ root, atMs: 0 })

    expect(result.truncated).toBe(false)
    expect(result.dom).not.toContain(TRUNCATION_NOTE)
    expect(result.dom).toContain('[DISABLED]')
  })

  /**
   * The justification for priority-ordered truncation, as an assertion.
   *
   * compress-dom.test.ts checks that a pathologically deep tree stays inside the budget and reports
   * `truncated`, which a positional "keep the first 60 lines" implementation would also satisfy — while
   * dropping exactly the element the agent is looking for. This is the property that distinguishes the
   * two, and it was unguarded: a disabled control buried under forty wrappers is routinely the whole
   * bug, and the decorative spans crowding it out are never the bug.
   */
  it('sheds decorative text before a buried interactive element', () => {
    let inner = '<button type="button" disabled>Buried but interactive</button>'
    for (let depth = 0; depth < 40; depth += 1) {
      inner = `<div class="flex flex-col gap-2 p-1"><span>label ${depth}</span>${inner}</div>`
    }
    const decoration = Array.from({ length: 400 }, (_, index) => `<span class="text-xs">note ${index}</span>`).join('')
    const root = fixture(`<div class="p-4">${inner}${decoration}</div>`)

    const result = compressDom({ root, atMs: 0 })

    expect(result.truncated).toBe(true)
    expect(result.charCount).toBeLessThanOrEqual(MAX_CHARS)
    expect(result.dom).toContain('Buried but interactive')
    expect(result.dom).toContain('[DISABLED]')
    // And the noise that would have crowded it out under positional truncation is gone.
    expect(result.dom).not.toContain('note 399')
  })
})
