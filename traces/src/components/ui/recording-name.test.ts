import { describe, expect, it } from 'vitest'
import { deriveRecordingName } from './recording-name'

/**
 * The one part of loading a chosen file that gets real tests, because it is the one part that can be
 * wrong without anything on screen looking wrong. A bad `label` is visible immediately in the header; a
 * bad `id` is not visible at all until a snapshot is written under a key nobody can find again.
 */

describe('deriveRecordingName', () => {
  it('strips the .session.json the recorder writes, not just the last extension', () => {
    expect(deriveRecordingName('my-bug.session.json')).toEqual({ id: 'my-bug', label: 'my-bug' })
  })

  it('strips a plain .json', () => {
    expect(deriveRecordingName('empty-province.json')).toEqual({
      id: 'empty-province',
      label: 'empty-province',
    })
  })

  it('ignores extension case, since the filesystem decides that and not the file input', () => {
    expect(deriveRecordingName('Checkout.SESSION.JSON').id).toBe('checkout')
    expect(deriveRecordingName('Checkout.JSON').label).toBe('Checkout')
  })

  it('keeps capitals and spaces in the label, and lowercases and hyphenates the id', () => {
    expect(deriveRecordingName('MY BUG.json')).toEqual({ id: 'my-bug', label: 'MY BUG' })
  })

  it('collapses runs of whitespace rather than passing them through', () => {
    expect(deriveRecordingName('  pay   button \t stuck .json')).toEqual({
      id: 'pay-button-stuck',
      label: 'pay button stuck',
    })
  })

  it('caps a long name at 80 characters and does not leave the cut trailing a space', () => {
    const { id, label } = deriveRecordingName(`${'a'.repeat(300)}.json`)

    expect(label).toHaveLength(80)
    expect(id).toHaveLength(80)

    const spaced = deriveRecordingName(`${'b'.repeat(79)} tail.json`)
    expect(spaced.label).toBe('b'.repeat(79))
    expect(spaced.label.endsWith(' ')).toBe(false)
  })

  /*
   * The point of this case and the one below it is that both halves of the result leave this function:
   * `label` into the activity feed, `id` into a `localStorage` key and into `recordingId` in the
   * `snapshot_finding` response a model reads. Neither may come back empty, and the id may not carry a
   * character a key or a model would have to interpret. Nothing here is a claim that a path is
   * reachable from a file input — browsers hand over a bare `File.name` — only that the string is
   * untrusted and is normalised before it travels.
   */
  it('falls back rather than returning an empty id when no character survives slugifying', () => {
    expect(deriveRecordingName('!!!.json')).toEqual({ id: 'recording', label: '!!!' })
    expect(deriveRecordingName('---')).toEqual({ id: 'recording', label: '---' })
  })

  it('falls back for both halves on an empty name', () => {
    expect(deriveRecordingName('')).toEqual({ id: 'recording', label: 'recording' })
    expect(deriveRecordingName('.json')).toEqual({ id: 'recording', label: 'recording' })
  })

  it('reduces separators to hyphens, so nothing path-shaped reaches a storage key', () => {
    expect(deriveRecordingName('../../etc/passwd')).toEqual({
      id: 'etc-passwd',
      label: '../../etc/passwd',
    })
  })

  it('produces an id matching the closed character set, for every name above', () => {
    const names = [
      'my-bug.session.json',
      'MY BUG.json',
      `${'a'.repeat(300)}.json`,
      '!!!.json',
      '',
      '../../etc/passwd',
      'späte Zahlung.json',
      'recording (1).json',
    ]

    for (const name of names) {
      expect(deriveRecordingName(name).id).toMatch(/^[a-z0-9-]+$/)
    }
  })
})
