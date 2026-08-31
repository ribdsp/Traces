import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The XHR recorder, and why it is tested at all when the fetch one next to it never was.
 *
 * `read_network` reads exactly one thing: `network-request` custom events that this file's subject puts
 * into the recording. Before `installXhrRecorder` existed, a page on axios's default adapter, jQuery, or
 * any older SDK produced a recording with an empty network timeline — and an agent reading that is not
 * told "this recorder cannot see XHR", it is told "the page made no requests". A wrong answer that looks
 * like an answer is the failure worth holding still with tests.
 *
 * So the assertions below are about the event's *shape* matching what `read_network` parses, about the
 * three terminal states a request can reach, and about one thing that is a rule rather than a behaviour:
 * **no request or response body may appear in the event.** `maskAllInputs: true` keeps typed values out
 * of the recording, and a checkout's XHR payload is the same class of risk — see docs/threat-model.md
 * (T4). The abort test sends a card number and asserts it is nowhere in what was recorded.
 *
 * `record.addCustomEvent` is mocked because the subject is the patch, not rrweb. `XMLHttpRequest` is
 * replaced with a fake whose terminal state the test drives, because the alternative is a unit test that
 * makes real network calls.
 */

const { addCustomEvent } = vi.hoisted(() => ({ addCustomEvent: vi.fn() }))

vi.mock('rrweb', () => ({
  record: Object.assign(
    // A truthy return: `startRecording` throws when rrweb declines to start.
    vi.fn(() => () => {}),
    { addCustomEvent, takeFullSnapshot: vi.fn() },
  ),
}))

vi.mock('@rrweb/rrweb-plugin-console-record', () => ({
  getRecordConsolePlugin: () => ({ name: 'rrweb/console@1' }),
}))

const { currentRecorder, startRecording } = await import('./record')

/** The tag `read_network` matches literally. Duplicated so a typo in the source is a failure here. */
const NETWORK_REQUEST_TAG = 'network-request'

type Outcome = { status: number; contentType?: string }

/**
 * A stand-in for `XMLHttpRequest` whose outcome the test decides.
 *
 * `open` and `send` are prototype methods, which is what makes this a fair target: the patch replaces
 * them on the prototype and has to call through to whatever it displaced, and `openedWith`/`sentBodies`
 * are how the tests prove it did.
 */
class FakeXhr extends EventTarget {
  status = 0
  readonly openedWith: Array<{ method: string; url: string; async: boolean }> = []
  readonly sentBodies: unknown[] = []
  private readonly headers = new Map<string, string>()

  open(method: string, url: string | URL, async = true): void {
    this.openedWith.push({ method, url: String(url), async })
  }

  send(body?: unknown): void {
    this.sentBodies.push(body)
  }

  getResponseHeader(name: string): string | null {
    return this.headers.get(name.toLowerCase()) ?? null
  }

  /** What the browser does at the end of a request, in the order it does it. */
  finish({ status, contentType }: Outcome): void {
    this.status = status
    if (contentType !== undefined) this.headers.set('content-type', contentType)
    this.dispatchEvent(new Event('loadend'))
  }
}

// Captured before any test can patch them, so each test starts from an unpatched prototype.
const PRISTINE_OPEN = FakeXhr.prototype.open
const PRISTINE_SEND = FakeXhr.prototype.send

/** The single event the subject emitted, as `read_network` would receive it. */
function recordedPayload(): Record<string, unknown> {
  expect(addCustomEvent).toHaveBeenCalledTimes(1)

  const call = addCustomEvent.mock.calls.at(0)
  // The assertion above already covers this; the throw is what narrows the type, and a named failure
  // beats the `undefined is not iterable` a destructure would produce.
  if (call === undefined) throw new Error('no network-request event was recorded')

  const [tag, payload] = call
  expect(tag).toBe(NETWORK_REQUEST_TAG)
  return payload as Record<string, unknown>
}

beforeEach(() => {
  FakeXhr.prototype.open = PRISTINE_OPEN
  FakeXhr.prototype.send = PRISTINE_SEND
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
  addCustomEvent.mockClear()
})

afterEach(() => {
  currentRecorder()?.stop()
  vi.unstubAllGlobals()
})

describe('the XMLHttpRequest recorder', () => {
  it('records a successful GET, and calls through to the request it patched', () => {
    // Arrange
    startRecording('successful-get')
    const xhr = new FakeXhr()

    // Act
    xhr.open('get', '/api/provinces')
    xhr.send()
    xhr.finish({ status: 200, contentType: 'application/json; charset=utf-8' })

    // Assert: the six fields read-network.ts parses, and nothing else.
    expect(recordedPayload()).toEqual({
      url: '/api/provinces',
      method: 'GET',
      status: 200,
      ok: true,
      durationMs: expect.any(Number),
      bodySummary: 'application/json, not summarised',
    })

    // The patch is transparent: the underlying request ran, with the caller's own arguments.
    expect(xhr.openedWith).toEqual([{ method: 'get', url: '/api/provinces', async: true }])
    expect(xhr.sentBodies).toHaveLength(1)
  })

  it('records a 500 as not ok, keeping the status the server sent', () => {
    // Arrange: the failure `read_network` sorts to the top, so the status has to survive intact.
    startRecording('server-error')
    const xhr = new FakeXhr()

    // Act
    xhr.open('GET', '/api/cities?province=')
    xhr.send()
    xhr.finish({ status: 500, contentType: 'application/json' })

    // Assert
    expect(recordedPayload()).toMatchObject({
      url: '/api/cities?province=',
      method: 'GET',
      status: 500,
      ok: false,
      bodySummary: 'application/json, not summarised',
    })
  })

  it('records an aborted request as status 0 with no response, and no trace of the body', () => {
    // Arrange: a request that never gets a response, carrying the kind of payload a checkout sends.
    startRecording('aborted')
    const xhr = new FakeXhr()
    const secret = '4111111111111111'

    // Act: an abort fires `loadend` with `status` still 0 — the same state as a network error or timeout.
    xhr.open('POST', '/api/order')
    xhr.send(JSON.stringify({ card: secret, address: '12 Example Street' }))
    xhr.finish({ status: 0 })

    // Assert
    const payload = recordedPayload()
    expect(payload).toMatchObject({
      url: '/api/order',
      method: 'POST',
      status: 0,
      ok: false,
      bodySummary: 'no response',
    })

    // The rule, not an incidental: the body reached the network and nothing of it reached the recording.
    expect(JSON.stringify(payload)).not.toContain(secret)
    expect(JSON.stringify(payload)).not.toContain('Example Street')
    expect(xhr.sentBodies).toHaveLength(1)
  })

  it('starts and stops cleanly where XMLHttpRequest does not exist', () => {
    // Arrange: a server render, or any host without XHR. There is nothing to patch and nothing to fix.
    vi.stubGlobal('XMLHttpRequest', undefined)

    // Act & Assert: `startRecording` still has to hand back a working handle.
    const handle = startRecording('no-xhr')
    expect(() => handle.stop()).not.toThrow()
    expect(addCustomEvent).not.toHaveBeenCalled()
  })

  it('records through an XHR another library already patched, and gives that patch back on stop', () => {
    // Arrange: someone else got to the prototype first — axios's adapter, a polyfill, a mocking library.
    const throughLibrary: string[] = []
    FakeXhr.prototype.open = function libraryOpen(
      this: FakeXhr,
      method: string,
      url: string | URL,
      async = true,
    ): void {
      throughLibrary.push(String(url))
      PRISTINE_OPEN.call(this, method, url, async)
    }
    const libraryOpen = FakeXhr.prototype.open

    // Act
    const handle = startRecording('already-patched')
    const during = new FakeXhr()
    during.open('GET', '/api/provinces')
    during.send()
    during.finish({ status: 200 })
    handle.stop()

    // Assert: recorded, and the other library's patch ran too rather than being displaced.
    expect(recordedPayload()).toMatchObject({ url: '/api/provinces', status: 200, ok: true })
    expect(throughLibrary).toEqual(['/api/provinces'])

    // Teardown restores what was found, not the pristine method — the other patch outlives the recording.
    expect(FakeXhr.prototype.open).toBe(libraryOpen)
    expect(FakeXhr.prototype.send).toBe(PRISTINE_SEND)
  })

  it('stops recording once the handle is stopped', () => {
    // Arrange: the teardown the fetch patch has, asserted the same way — a request after `stop`.
    const handle = startRecording('after-stop')
    handle.stop()
    const xhr = new FakeXhr()

    // Act
    xhr.open('GET', '/api/provinces')
    xhr.send()
    xhr.finish({ status: 200, contentType: 'application/json' })

    // Assert: the request still worked, and the recording did not grow.
    expect(addCustomEvent).not.toHaveBeenCalled()
    expect(xhr.openedWith).toHaveLength(1)
  })

  it('reports a response with no content-type without claiming to know its shape', () => {
    // Arrange: a 204, or any response that declares nothing. `bodySummary` must still be honest.
    startRecording('no-content-type')
    const xhr = new FakeXhr()

    // Act
    xhr.open('DELETE', '/api/cart/1')
    xhr.send()
    xhr.finish({ status: 204 })

    // Assert: 204 is a success, and the summary says only that nothing was summarised.
    expect(recordedPayload()).toMatchObject({
      method: 'DELETE',
      status: 204,
      ok: true,
      bodySummary: 'not summarised',
    })
  })
})
