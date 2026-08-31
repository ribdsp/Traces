import { describe, expect, it } from 'vitest'
import { ASK_CHOICE_MAX, validateChoices } from './ask-human-visual'
import { HYPOTHESES_MAX, normaliseConfidences, validateHypotheses } from './propose-hypotheses'
import { capList, capText, clampToRecording } from './tool-support'

/**
 * The validators and budgets the blocking tools are built on, tested away from the store and the gate.
 *
 * These are the parts where a bug is silent rather than loud. A confidence set that does not sum to 1
 * still renders — as bars that all look near-certain. A choice one character too long still renders — as
 * a truncated button a human answers wrongly. Neither throws, so neither shows up without a test.
 */

describe('normaliseConfidences', () => {
  it('leaves a set that already sums to 1 alone', () => {
    expect(normaliseConfidences([0.5, 0.3, 0.2])).toEqual([0.5, 0.3, 0.2])
  })

  it('rescales a set that sums to more than 1, keeping the ranking', () => {
    const normalised = normaliseConfidences([0.9, 0.6, 0.3])

    expect(normalised.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 2)
    expect(normalised[0]).toBeGreaterThan(normalised[1] ?? 0)
    expect(normalised[1]).toBeGreaterThan(normalised[2] ?? 0)
  })

  it('rescales a set that sums to less than 1', () => {
    expect(normaliseConfidences([0.1, 0.1])).toEqual([0.5, 0.5])
  })

  it('treats a negative or non-finite claim as no claim rather than rejecting the set', () => {
    expect(normaliseConfidences([1, -1, Number.NaN])).toEqual([1, 0, 0])
  })

  it('splits evenly when nothing usable was claimed, which is the honest reading of it', () => {
    expect(normaliseConfidences([0, 0])).toEqual([0.5, 0.5])
  })

  it('handles an empty set without dividing by zero', () => {
    expect(normaliseConfidences([])).toEqual([])
  })
})

describe('validateChoices', () => {
  it('accepts two to four distinct short choices, trimmed', () => {
    const checked = validateChoices([' looked broken ', 'looked normal but empty'])

    expect(checked.ok).toBe(true)
    if (checked.ok) expect(checked.choices).toEqual(['looked broken', 'looked normal but empty'])
  })

  it('rejects a single choice, because one option is a confirmation and not a question', () => {
    const checked = validateChoices(['yes'])

    expect(checked.ok).toBe(false)
    if (!checked.ok) expect(checked.error).toMatch(/2 to 4/)
  })

  it('rejects five choices', () => {
    expect(validateChoices(['a', 'b', 'c', 'd', 'e']).ok).toBe(false)
  })

  it('rejects a choice too long to fit on a button, naming the limit', () => {
    const checked = validateChoices(['ok', 'x'.repeat(ASK_CHOICE_MAX + 1)])

    expect(checked.ok).toBe(false)
    if (!checked.ok) expect(checked.error).toContain(String(ASK_CHOICE_MAX))
  })

  it('rejects duplicates: the overlay keys its buttons by the choice text', () => {
    const checked = validateChoices(['Empty', 'empty'])

    expect(checked.ok).toBe(false)
    if (!checked.ok) expect(checked.error).toMatch(/distinct/)
  })

  it('rejects a non-array and an empty string, readably', () => {
    expect(validateChoices('looked broken').ok).toBe(false)
    expect(validateChoices(['ok', '  ']).ok).toBe(false)
  })
})

describe('validateHypotheses', () => {
  const markers = new Set<string>(['marker-1'])
  const valid = () => [
    { text: 'The province list never loads', confidence: 0.6, evidence: [{ atMs: 1_000, note: 'select empty' }] },
    { text: 'The country change resets it', confidence: 0.4, evidence: [{ atMs: 2_000 }] },
  ]

  it('accepts a well-formed pair and defaults a missing note to an empty string', () => {
    const checked = validateHypotheses(valid(), 5_000, markers)

    expect(checked.ok).toBe(true)
    if (checked.ok) {
      expect(checked.hypotheses).toHaveLength(2)
      expect(checked.hypotheses[1]?.evidence[0]).toEqual({ atMs: 2_000, note: '' })
    }
  })

  it('rejects a hypothesis with no evidence, and says why the rule exists', () => {
    const entries = valid()
    const checked = validateHypotheses(
      [{ ...entries[0] }, { text: 'A guess', confidence: 0.4, evidence: [] }],
      5_000,
      markers,
    )

    expect(checked.ok).toBe(false)
    if (!checked.ok) {
      expect(checked.error).toMatch(/Hypothesis 2 has no evidence/)
      expect(checked.error).toMatch(/timeline/)
    }
  })

  it('rejects evidence outside the recording, which would highlight nothing when clicked', () => {
    const checked = validateHypotheses(
      [{ text: 'a', confidence: 0.5, evidence: [{ atMs: 61_000 }] }, ...valid()],
      5_000,
      markers,
    )

    expect(checked.ok).toBe(false)
    if (!checked.ok) expect(checked.error).toMatch(/outside this 5000ms recording/)
  })

  it('rejects a markerId that is not on the timeline', () => {
    const checked = validateHypotheses(
      [
        { text: 'a', confidence: 0.5, evidence: [{ atMs: 1_000, markerId: 'invented' }] },
        { text: 'b', confidence: 0.5, evidence: [{ atMs: 1_200 }] },
      ],
      5_000,
      markers,
    )

    expect(checked.ok).toBe(false)
    if (!checked.ok) expect(checked.error).toMatch(/not a marker on this timeline/)
  })

  it('accepts a markerId that is', () => {
    const checked = validateHypotheses(
      [
        { text: 'a', confidence: 0.5, evidence: [{ atMs: 1_000, markerId: 'marker-1' }] },
        { text: 'b', confidence: 0.5, evidence: [{ atMs: 1_200 }] },
      ],
      5_000,
      markers,
    )

    expect(checked.ok).toBe(true)
  })

  it('rejects one hypothesis and more than the maximum, since the set is meant to be ranked', () => {
    expect(validateHypotheses([valid()[0] as Record<string, unknown>], 5_000, markers).ok).toBe(false)

    const tooMany = Array.from({ length: HYPOTHESES_MAX + 1 }, (_, index) => ({
      text: `guess ${index}`,
      confidence: 0.5,
      evidence: [{ atMs: 1_000 }],
    }))
    expect(validateHypotheses(tooMany, 5_000, markers).ok).toBe(false)
  })

  it('caps evidence per hypothesis and says what to do instead of only that it cut something', () => {
    const checked = validateHypotheses(
      [
        {
          text: 'a',
          confidence: 0.5,
          evidence: Array.from({ length: 9 }, (_, index) => ({ atMs: index * 100 })),
        },
        { text: 'b', confidence: 0.5, evidence: [{ atMs: 1_200 }] },
      ],
      5_000,
      markers,
    )

    expect(checked.ok).toBe(true)
    if (checked.ok) {
      expect(checked.hypotheses[0]?.evidence).toHaveLength(5)
      expect(checked.notes.join(' ')).toMatch(/strongest/)
    }
  })

  it('rejects a missing or non-numeric confidence rather than assuming one', () => {
    const checked = validateHypotheses(
      [{ text: 'a', evidence: [{ atMs: 1_000 }] }, ...valid()],
      5_000,
      markers,
    )

    expect(checked.ok).toBe(false)
    if (!checked.ok) expect(checked.error).toMatch(/confidence/)
  })
})

describe('budgets', () => {
  it('capText flattens whitespace and marks what it shortened', () => {
    expect(capText('  two   words\n', 40)).toEqual({ text: 'two words', truncated: false })

    const capped = capText('x'.repeat(50), 10)
    expect(capped.truncated).toBe(true)
    expect(capped.text).toHaveLength(10)
  })

  it('capList keeps the first entries and reports the rest were dropped', () => {
    expect(capList([1, 2, 3], 5)).toEqual({ items: [1, 2, 3], truncated: false })
    expect(capList([1, 2, 3], 2)).toEqual({ items: [1, 2], truncated: true })
  })

  it('clampToRecording keeps a playhead on the timeline and says when it moved a number', () => {
    expect(clampToRecording(1_200.4, 5_000)).toEqual({ atMs: 1_200, clamped: false })
    expect(clampToRecording(9_000, 5_000)).toEqual({ atMs: 5_000, clamped: true })
    expect(clampToRecording(-5, 5_000)).toEqual({ atMs: 0, clamped: true })
  })
})
