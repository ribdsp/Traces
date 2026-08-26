import { describe, expect, it } from 'vitest'
import { PREDICATE_KINDS, evaluatePredicate, validatePredicate, validateSelector } from './predicate'

describe('validatePredicate — the closed set holds', () => {
  it('rejects an expression variant, which is the whole reason this validator exists', () => {
    const result = validatePredicate({ kind: 'jsExpression', code: 'el.disabled === true' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      // The message has to teach the agent what it may use, or it retries the same call.
      expect(result.error).toContain('jsExpression')
      for (const kind of PREDICATE_KINDS) expect(result.error).toContain(kind)
    }
  })

  it('rejects a non-object', () => {
    expect(validatePredicate('disabled === true').ok).toBe(false)
    expect(validatePredicate(null).ok).toBe(false)
    expect(validatePredicate([{ kind: 'exists', equals: true }]).ok).toBe(false)
  })

  it('rejects a missing kind', () => {
    expect(validatePredicate({ property: 'disabled', equals: true }).ok).toBe(false)
  })

  it('accepts every documented variant', () => {
    const valid: unknown[] = [
      { kind: 'propertyEquals', property: 'disabled', equals: true },
      { kind: 'propertyEquals', property: 'value', equals: 'Bandung' },
      { kind: 'attributeExists', attribute: 'aria-invalid' },
      { kind: 'attributeEquals', attribute: 'data-state', equals: 'loading' },
      { kind: 'optionCount', equals: 0 },
      { kind: 'visible', equals: false },
      { kind: 'textContains', text: 'Something went wrong' },
      { kind: 'exists', equals: true },
    ]
    for (const input of valid) {
      expect(validatePredicate(input), JSON.stringify(input)).toMatchObject({ ok: true })
    }
  })
})

describe('validatePredicate — field validation', () => {
  it('rejects a property outside the allowed four', () => {
    expect(validatePredicate({ kind: 'propertyEquals', property: 'innerHTML', equals: '<b>x</b>' }).ok).toBe(false)
    expect(validatePredicate({ kind: 'propertyEquals', property: 'onclick', equals: 'alert(1)' }).ok).toBe(false)
  })

  it('rejects attribute names carrying anything but letters and hyphens', () => {
    for (const attribute of ['data-x"]', 'aria label', 'a'.repeat(31), '', 'x=1']) {
      expect(validatePredicate({ kind: 'attributeExists', attribute }).ok, attribute).toBe(false)
    }
  })

  it('caps text length', () => {
    expect(validatePredicate({ kind: 'textContains', text: 'x'.repeat(101) }).ok).toBe(false)
    expect(validatePredicate({ kind: 'textContains', text: 'x'.repeat(100) }).ok).toBe(true)
  })

  it('rejects a non-integer or negative optionCount', () => {
    expect(validatePredicate({ kind: 'optionCount', equals: 1.5 }).ok).toBe(false)
    expect(validatePredicate({ kind: 'optionCount', equals: -1 }).ok).toBe(false)
    expect(validatePredicate({ kind: 'optionCount', equals: 0 }).ok).toBe(true)
  })

  it('requires booleans where the contract says boolean', () => {
    expect(validatePredicate({ kind: 'visible', equals: 'false' }).ok).toBe(false)
    expect(validatePredicate({ kind: 'exists', equals: 1 }).ok).toBe(false)
  })
})

describe('validateSelector', () => {
  it('accepts a realistic selector', () => {
    expect(validateSelector('#checkout button[type=submit]').ok).toBe(true)
  })

  it('rejects malformed selectors before any replaying happens', () => {
    expect(validateSelector('#checkout button[').ok).toBe(false)
    expect(validateSelector('::').ok).toBe(false)
  })

  it('rejects empty input and over-long input', () => {
    expect(validateSelector('   ').ok).toBe(false)
    expect(validateSelector(42).ok).toBe(false)
    expect(validateSelector(`.a${'.b'.repeat(120)}`).ok).toBe(false)
  })
})

describe('evaluatePredicate', () => {
  function el(html: string): Element {
    const host = document.createElement('div')
    host.innerHTML = html
    const child = host.firstElementChild
    if (!child) throw new Error('fixture produced no element')
    return child
  }

  it('reads the disabled property', () => {
    const predicate = { kind: 'propertyEquals', property: 'disabled', equals: true } as const
    expect(evaluatePredicate(predicate, el('<button disabled>Pay</button>'))).toBe(true)
    expect(evaluatePredicate(predicate, el('<button>Pay</button>'))).toBe(false)
  })

  it('reads the live value property, not the attribute', () => {
    const input = el('<input name="city" value="Bandung" />') as HTMLInputElement
    input.value = 'Bogor' // what the user actually typed after the page rendered
    expect(evaluatePredicate({ kind: 'propertyEquals', property: 'value', equals: 'Bogor' }, input)).toBe(true)
    expect(evaluatePredicate({ kind: 'propertyEquals', property: 'value', equals: 'Bandung' }, input)).toBe(false)
  })

  it('counts options — zero is the empty-province bug', () => {
    expect(evaluatePredicate({ kind: 'optionCount', equals: 0 }, el('<select name="province"></select>'))).toBe(true)
    expect(
      evaluatePredicate({ kind: 'optionCount', equals: 0 }, el('<select><option>Bandung</option></select>')),
    ).toBe(false)
  })

  it('matches text case-insensitively', () => {
    const predicate = { kind: 'textContains', text: 'went wrong' } as const
    expect(evaluatePredicate(predicate, el('<p>Something Went Wrong</p>'))).toBe(true)
    expect(evaluatePredicate(predicate, el('<p>All good</p>'))).toBe(false)
  })

  it('treats a missing element as false for every variant', () => {
    expect(evaluatePredicate({ kind: 'exists', equals: true }, null)).toBe(false)
    expect(evaluatePredicate({ kind: 'propertyEquals', property: 'disabled', equals: false }, null)).toBe(false)
    // Note: `exists: false` is also false here. The caller reports elementMissing separately, so the
    // agent can tell "not there yet" from "there and enabled" — see BisectStep in types/domain.ts.
  })
})
