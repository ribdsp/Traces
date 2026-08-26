import { describe, expect, it } from 'vitest'
import { GATE_TIMEOUT_MS, answerGate, createGate, pendingTickets, retryGate } from './blocking'

/**
 * The blocking contract from docs/tools.md#blocking-tools, pinned.
 *
 * Every case here is about a *timing* seam, which is why they are worth automating: each failure mode
 * below looks identical from the outside — an agent that keeps polling and a human staring at a
 * question they already answered — and none of them throws. The one that matters most is "answered
 * between two polls", because it is also the most likely: the human takes their time, the first call
 * has already returned its ticket, and there is no promise in existence at the moment they click.
 */

/** Short enough to keep the suite fast, long enough that a resolve in the same tick wins the race. */
const SHORT = 20

describe('createGate', () => {
  it('resolves with the answer when the human is quick', async () => {
    const gate = createGate<string>('ask', SHORT)
    gate.resolve('looked normal but empty')

    await expect(gate.promise).resolves.toEqual({
      status: 'answered',
      value: 'looked normal but empty',
    })
  })

  it('resolves with a ticket rather than hanging when the human is slow', async () => {
    const gate = createGate<string>('ask', SHORT)
    const result = await gate.promise

    expect(result.status).toBe('pending')
    if (result.status === 'pending') expect(result.ticket).toBe(gate.ticket)
  })

  it('leaves the question open after the timeout, because the ticket has to lead somewhere', async () => {
    const gate = createGate<string>('ask', SHORT)
    await gate.promise

    expect(pendingTickets()).toContain(gate.ticket)
  })

  it('defaults to the configured timeout', () => {
    expect(GATE_TIMEOUT_MS).toBeGreaterThan(0)
  })
})

describe('answerGate', () => {
  it('delivers to whoever is waiting', async () => {
    const gate = createGate<number>('mark', SHORT)
    expect(answerGate(gate.ticket, 12_800)).toBe(true)

    await expect(gate.promise).resolves.toEqual({ status: 'answered', value: 12_800 })
  })

  it('reports an unknown ticket instead of throwing — a human may answer an abandoned question', () => {
    expect(answerGate('ask-deadbeef', 'anything')).toBe(false)
  })

  it('ignores a second answer: two clicks on one prompt is one answer', async () => {
    const gate = createGate<string>('ask', SHORT)

    expect(answerGate(gate.ticket, 'first')).toBe(true)
    expect(answerGate(gate.ticket, 'second')).toBe(false)
    await expect(gate.promise).resolves.toEqual({ status: 'answered', value: 'first' })
  })
})

describe('retryGate', () => {
  it('collects an answer that arrived after the timeout, between two polls', async () => {
    const gate = createGate<string>('ask', SHORT)
    const first = await gate.promise
    expect(first.status).toBe('pending')

    // The human clicks now, while no tool call is outstanding. Nothing exists to resolve.
    expect(answerGate(gate.ticket, 'looked broken')).toBe(true)

    const retry = retryGate<string>(gate.ticket, SHORT)
    expect(retry).not.toBeNull()
    await expect(retry as Promise<unknown>).resolves.toEqual({
      status: 'answered',
      value: 'looked broken',
    })
  })

  it('attaches to the same question rather than opening a second one', async () => {
    const gate = createGate<string>('ask', SHORT)
    await gate.promise

    const retry = retryGate<string>(gate.ticket, 10_000)
    // One answer, delivered to the retry — not a fresh question the human never saw.
    expect(answerGate(gate.ticket, 'same question')).toBe(true)

    await expect(retry as Promise<unknown>).resolves.toEqual({
      status: 'answered',
      value: 'same question',
    })
  })

  it('returns null for a ticket it does not recognise, so the tool can say so readably', () => {
    expect(retryGate('ask-notathing')).toBeNull()
  })

  it('retires the ticket once the answer has been collected', async () => {
    const gate = createGate<string>('ask', SHORT)
    await gate.promise
    answerGate(gate.ticket, 'collected')
    await retryGate<string>(gate.ticket, SHORT)

    expect(pendingTickets()).not.toContain(gate.ticket)
    expect(retryGate(gate.ticket)).toBeNull()
  })

  it('can time out again, leaving the question open for the next poll', async () => {
    const gate = createGate<string>('ask', SHORT)
    await gate.promise

    const retry = await (retryGate<string>(gate.ticket, SHORT) as Promise<{ status: string }>)
    expect(retry.status).toBe('pending')
    expect(pendingTickets()).toContain(gate.ticket)
  })
})
