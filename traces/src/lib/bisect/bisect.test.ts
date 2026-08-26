import { describe, expect, it } from 'vitest'
import { DEFAULT_PRECISION_MS, bisect, type BisectProbe } from './bisect'

/**
 * The four cases from PLAN.md Day 2, plus the ones that produce a *confidently wrong* answer rather
 * than an error. Those are the dangerous ones: an exception gets fixed in ten minutes, a timestamp
 * that is off by one probe gets written into a bug report and believed.
 */

/** A probe whose predicate flips to true at `transitionAtMs` and stays true. */
function monotonicProbe(transitionAtMs: number, calls: number[] = []): BisectProbe {
  return async (atMs) => {
    calls.push(atMs)
    return { result: atMs >= transitionAtMs, elementMissing: false }
  }
}

describe('bisect — the normal case', () => {
  it('finds the transition within the requested precision', async () => {
    const result = await bisect({ from: 0, to: 47_000, probe: monotonicProbe(28_412) })
    expect(result.firstTrue).not.toBeNull()
    expect(Math.abs((result.firstTrue as number) - 28_412)).toBeLessThanOrEqual(DEFAULT_PRECISION_MS)
  })

  it('returns a firstTrue where the predicate actually holds, and a lastFalse where it does not', async () => {
    const probe = monotonicProbe(28_412)
    const result = await bisect({ from: 0, to: 47_000, probe })
    const atFirstTrue = await probe(result.firstTrue as number)
    const atLastFalse = await probe(result.lastFalse as number)
    expect(atFirstTrue.result).toBe(true)
    expect(atLastFalse.result).toBe(false)
  })

  it('takes about six probes on a 47-second recording, not forty', async () => {
    const calls: number[] = []
    const result = await bisect({ from: 0, to: 47_000, probe: monotonicProbe(28_412, calls) })
    // log2(47000 / 250) ≈ 7.6, plus the two boundary probes.
    expect(result.iterations).toBeLessThanOrEqual(12)
    expect(calls.length).toBe(result.trace.length)
  })

  it('records every probe in the order it ran — BisectTrace animates this array', async () => {
    const calls: number[] = []
    const result = await bisect({ from: 0, to: 47_000, probe: monotonicProbe(28_412, calls) })
    expect(result.trace.map((step) => step.atMs)).toEqual(calls)
  })

  it('honours a coarser precision with fewer probes', async () => {
    const fine = await bisect({ from: 0, to: 47_000, probe: monotonicProbe(28_412), precisionMs: 250 })
    const coarse = await bisect({ from: 0, to: 47_000, probe: monotonicProbe(28_412), precisionMs: 2_000 })
    expect(coarse.iterations).toBeLessThan(fine.iterations)
    expect(coarse.precisionMs).toBe(2_000)
  })
})

describe('bisect — the cases that would otherwise produce a wrong answer', () => {
  it('flags a predicate that already held at the start of the window', async () => {
    const result = await bisect({ from: 10_000, to: 47_000, probe: monotonicProbe(0) })
    expect(result.alreadyTrueAtStart).toBe(true)
    expect(result.firstTrue).toBe(10_000)
  })

  it('returns null rather than an error when the predicate never holds', async () => {
    const result = await bisect({ from: 0, to: 47_000, probe: monotonicProbe(Number.POSITIVE_INFINITY) })
    expect(result.firstTrue).toBeNull()
  })

  it('does not search when the predicate is already false at the end of the window', async () => {
    const calls: number[] = []
    await bisect({ from: 0, to: 47_000, probe: monotonicProbe(Number.POSITIVE_INFINITY, calls) })
    expect(calls.length).toBeLessThanOrEqual(2)
  })

  it('carries elementMissing through, so absent is distinguishable from false', async () => {
    const probe: BisectProbe = async (atMs) => ({
      result: atMs >= 30_000,
      elementMissing: atMs < 20_000, // the element only enters the document at 20s
    })
    const result = await bisect({ from: 0, to: 47_000, probe })
    const early = result.trace.filter((step) => step.atMs < 20_000)
    expect(early.length).toBeGreaterThan(0)
    expect(early.every((step) => step.elementMissing === true)).toBe(true)
  })

  it('handles a zero-width window without looping forever', async () => {
    const result = await bisect({ from: 5_000, to: 5_000, probe: monotonicProbe(0) })
    expect(result.iterations).toBeGreaterThanOrEqual(0)
    expect(result.firstTrue).toBe(5_000)
  })
})

describe('bisect — reporting', () => {
  it('reports elapsedMs from the injected clock', async () => {
    let clock = 1_000
    const result = await bisect({
      from: 0,
      to: 47_000,
      probe: async (atMs) => {
        clock += 100 // each probe costs a replay
        return { result: atMs >= 28_412, elementMissing: false }
      },
      now: () => clock,
    })
    expect(result.elapsedMs).toBe(result.trace.length * 100)
  })
})
