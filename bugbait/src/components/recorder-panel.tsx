'use client'

import { useCallback, useEffect, useState } from 'react'
import { BUG_SPECS, BUGS, disarmScenario, type Bug } from '@/lib/bugs'
import { currentRecorder, isRecording, startRecording, type RecorderHandle, type RecordingSummary } from '@/lib/record'

/**
 * The recorder control.
 *
 * The requirement that shapes this whole component: **it must not exist in the DOM during a take.**
 * rrweb captures the document, so a "Download recording" button in the capture becomes a button the
 * agent finds while investigating, reasons about, and possibly reports. `blockClass` would not help —
 * rrweb still records a same-sized placeholder div, and an unexplained empty box is its own puzzle.
 *
 * So the panel unmounts *first* and recording starts *afterwards*, from an effect that runs once React
 * has committed the removal. Which leaves no button to press to stop, hence the keyboard shortcut. That
 * is the trade this component makes: a slightly awkward control in exchange for a clean recording.
 *
 * It is mounted on both pages rather than in the layout so that the recorder — which lives in module
 * state and survives client-side navigation — can be stopped from whichever page the session ends on.
 */

/** `.` rather than a letter: no browser or OS claims Ctrl+Shift+Period, and Ctrl+Shift+S is Save As. */
const STOP_COMBO = 'Ctrl + Shift + .'

type PanelState = 'idle' | 'recording' | 'finished'

export function RecorderPanel({ armed }: { armed: Bug | null }): React.JSX.Element | null {
  // Initialised from module state, not from `false`: after the navigation into /checkout this component
  // is mounting fresh in the middle of a take, and it has to know to render nothing.
  const [state, setState] = useState<PanelState>(() => (isRecording() ? 'recording' : 'idle'))
  const [handle, setHandle] = useState<RecorderHandle | null>(() => currentRecorder())
  const [summary, setSummary] = useState<RecordingSummary | null>(null)

  const label = armed ?? 'no-bug'

  // The panel is already out of the DOM by the time an effect runs, so the first full snapshot cannot
  // contain it. Starting the recorder in the click handler instead would capture the panel and the
  // click that dismissed it.
  useEffect(() => {
    if (state !== 'recording' || handle !== null) return
    setHandle(startRecording(label))
  }, [state, handle, label])

  const stop = useCallback(() => {
    const running = handle ?? currentRecorder()
    if (!running) return
    running.stop()
    setSummary(running.summary())
    setHandle(running)
    setState('finished')
  }, [handle])

  useEffect(() => {
    if (state !== 'recording') return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && (event.key === '.' || event.key === '>')) {
        event.preventDefault()
        stop()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [state, stop])

  if (state === 'recording') return null

  return (
    <div className="fixed bottom-4 right-4 w-72 border border-gray-300 bg-white p-3 text-xs shadow-sm">
      {state === 'idle' ? (
        <>
          <p className="font-medium text-gray-900">Recorder</p>
          <p className="mt-1 text-gray-500">
            {armed ? BUG_SPECS[armed].label : 'No scenario armed — the form will simply work.'}
          </p>
          <button
            type="button"
            onClick={() => setState('recording')}
            className="mt-2 w-full border border-gray-900 bg-gray-900 px-2 py-1 text-white"
          >
            Start recording
          </button>
          <p className="mt-2 text-gray-500">
            This panel disappears while recording. Press <kbd className="font-mono">{STOP_COMBO}</kbd> to
            stop.
          </p>

          {/*
            The scenario picker lives in here, not on the cart page, for the same reason as everything
            else in this component: a link reading `/checkout?bug=empty-province` in the recorded cart
            DOM would name the bug on the agent's first `read_dom_at`. Plain anchors, not `Link`, so each
            one is a full reload and every take starts from an identical state.
          */}
          <ul className="mt-2 border-t border-gray-200 pt-2 text-gray-500">
            {BUGS.map((bug) => (
              <li key={bug}>
                <a href={`/?bug=${bug}`} className={bug === armed ? 'font-medium text-gray-900' : 'underline'}>
                  {bug}
                </a>
              </li>
            ))}
            <li>
              <button
                type="button"
                className="underline"
                onClick={() => {
                  disarmScenario()
                  window.location.assign('/')
                }}
              >
                none
              </button>
            </li>
          </ul>
        </>
      ) : (
        <>
          <p className="font-medium text-gray-900">Recording stopped</p>
          {summary ? (
            <dl className="mt-1 space-y-0.5 text-gray-600">
              <div className="flex justify-between">
                <dt>duration</dt>
                <dd>{(summary.durationMs / 1000).toFixed(1)}s</dd>
              </div>
              <div className="flex justify-between">
                <dt>events</dt>
                <dd>{summary.total}</dd>
              </div>
              <div className="flex justify-between">
                <dt>full snapshots</dt>
                <dd>{summary.fullSnapshots}</dd>
              </div>
              <div className="flex justify-between">
                <dt>meta events</dt>
                <dd>{summary.metaEvents}</dd>
              </div>
            </dl>
          ) : null}
          <button
            type="button"
            onClick={() => handle?.download(label)}
            className="mt-2 w-full border border-gray-900 bg-gray-900 px-2 py-1 text-white"
          >
            Download recording
          </button>
          <p className="mt-2 text-gray-500">
            Both snapshot counts should be about one per five seconds, and equal to each other.
          </p>
        </>
      )}
    </div>
  )
}
