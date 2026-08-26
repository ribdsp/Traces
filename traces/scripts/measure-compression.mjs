/**
 * Measure the compression ratio of `compressDom` against the three real sample recordings.
 *
 * Run from the `traces` directory:
 *
 *     node scripts/measure-compression.mjs
 *
 * This is the script docs/agent-legible-dom.md § "Measuring it" points at. The compression ratio is a
 * headline claim, so it has to be reproducible by anyone who clones the repo — not quoted from a
 * harness that no longer exists.
 *
 * ## Method, and what it does not do
 *
 * There is no browser here and no `Replayer`. The DOM at an instant is reconstructed with
 * `rrweb-snapshot`'s `rebuild()` — the same serializer rrweb's own replayer uses — applied to a
 * **genuine FullSnapshot event** taken from the recording, inside a fresh jsdom document.
 *
 * - **No mutation replay.** Every number below is measured at a real FullSnapshot, so the tree is
 *   exactly what rrweb captured at that timestamp. Nothing is synthesised, patched or hand-written.
 *   The recordings carry a snapshot roughly every five seconds, and for all three bugs a snapshot
 *   lands after the symptom is on screen, so replaying incremental mutations was not needed.
 * - **The instant is chosen by a predicate, not by hand.** Each recording below states the condition
 *   that defines its critical instant; the script measures the *earliest* FullSnapshot that satisfies
 *   it and prints that timestamp. If the app or a recording changes so that no snapshot satisfies the
 *   predicate, this script fails loudly instead of quietly measuring a different moment.
 * - **jsdom implements no layout.** `compressDom`'s `[hidden]` annotation therefore reflects only the
 *   `hidden` attribute here, never CSS. (Checked: wiring jsdom's own `getComputedStyle` in as a global
 *   produces byte-identical output at all of these instants, because nothing inside `form#checkout` is
 *   CSS-hidden.) Geometry and occlusion are `measureLayout`'s job and are not measured here.
 * - **Timestamps are recording-relative**, on the same base `loadRecording` uses: milliseconds since
 *   the first event. They are the values you would pass to `read_dom_at`.
 *
 * ## Requires Node ≥ 22.18
 *
 * The script imports `src/lib/dom/compress-dom.ts` directly, through Node's built-in type stripping,
 * so it measures the shipping implementation rather than a copy that can drift out of date.
 */

import fs from 'node:fs'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

import { JSDOM } from 'jsdom'
import { createCache, rebuild } from 'rrweb-snapshot'

// Importing a .ts file from a package with no `"type": "module"` earns one warning that says nothing
// about the measurement. Dropped by code so the output is readable; every other warning still prints.
const warningListeners = process.listeners('warning')
process.removeAllListeners('warning')
process.on('warning', (warning) => {
  if (warning.code === 'MODULE_TYPELESS_PACKAGE_JSON') return
  for (const listener of warningListeners) listener(warning)
})

const [major = 0, minor = 0] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(
    `This script imports TypeScript directly and needs Node >= 22.18 (running ${process.versions.node}).`,
  )
  process.exit(1)
}

const { MAX_CHARS, MAX_LINES, compressDom } = await import('../src/lib/dom/compress-dom.ts')

const RECORDINGS_DIR = fileURLToPath(new URL('../public/recordings/', import.meta.url))

/** Read straight off disk: several of these packages do not export `./package.json`. */
function installedVersion(name) {
  const path = fileURLToPath(new URL(`../node_modules/${name}/package.json`, import.meta.url))
  return JSON.parse(fs.readFileSync(path, 'utf8')).version
}

/** rrweb event types, spelled out rather than imported: this script must not depend on app code. */
const FULL_SNAPSHOT = 2

/**
 * The three samples, each with the condition that defines its critical instant.
 *
 * The predicate is the honest part. "Measure at the moment the bug is on screen" is only a real claim
 * if the moment is derived from the recording, and the derivation is checked in.
 */
const RECORDINGS = [
  {
    file: 'empty-province.json',
    scope: 'form#checkout',
    /** The primary sample: the province list is empty, Pay is dead, and the error blames the postcode. */
    criticalState: '#province has zero options, #pay is disabled, and the postcode error is on screen',
    isCritical: (doc) => {
      const province = doc.querySelector('#province')
      const pay = doc.querySelector('#pay')
      return (
        province !== null &&
        province.querySelectorAll('option').length === 0 &&
        pay !== null &&
        pay.hasAttribute('disabled') &&
        doc.querySelector('#postcode-error') !== null
      )
    },
  },
  {
    file: 'race-condition.json',
    scope: 'form#checkout',
    criticalState: '#province is populated but #city still has zero options',
    isCritical: (doc) => {
      const province = doc.querySelector('#province')
      const city = doc.querySelector('#city')
      return (
        province !== null &&
        province.querySelectorAll('option').length > 1 &&
        city !== null &&
        city.querySelectorAll('option').length === 0
      )
    },
  },
  {
    file: 'overlay-blocks-button.json',
    scope: 'form#checkout',
    criticalState: '#pay is enabled and #promo-strip is present — the state in which the clicks vanish',
    isCritical: (doc) => {
      const pay = doc.querySelector('#pay')
      return pay !== null && !pay.hasAttribute('disabled') && doc.querySelector('#promo-strip') !== null
    },
  },
]

function readRecording(file) {
  const wrapper = JSON.parse(fs.readFileSync(`${RECORDINGS_DIR}${file}`, 'utf8'))
  // The file is `{ id, label, events, ... }`; the raw event array is `json.events`.
  const events = [...wrapper.events].sort((left, right) => left.timestamp - right.timestamp)
  return { label: wrapper.label, events, startedAt: events[0].timestamp }
}

/**
 * Rebuild one FullSnapshot into a fresh jsdom document.
 *
 * `UNSAFE_allowUnprotectedRebuild` is required by rrweb-snapshot >= 2.1 for any document that is not a
 * sandboxed iframe. It is safe here and only here: this jsdom is constructed without `runScripts`, so
 * it cannot execute a script even if a recording contained one — and rrweb serialises scripts as inert
 * `noscript` placeholders in the first place.
 */
function rebuildSnapshot(snapshot) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>')
  rebuild(snapshot.data.node, {
    doc: dom.window.document,
    cache: createCache(),
    UNSAFE_allowUnprotectedRebuild: true,
  })
  return dom.window.document
}

function measure(recording) {
  const { events, startedAt } = readRecording(recording.file)
  const snapshots = events.filter((event) => event.type === FULL_SNAPSHOT)

  for (const snapshot of snapshots) {
    const doc = rebuildSnapshot(snapshot)
    if (!recording.isCritical(doc)) continue

    const root = doc.querySelector(recording.scope)
    if (root === null) {
      throw new Error(`${recording.file}: the critical state was reached but "${recording.scope}" is absent.`)
    }

    const atMs = snapshot.timestamp - startedAt
    const rawChars = root.outerHTML.length
    const started = performance.now()
    const result = compressDom({ root, atMs })
    const elapsedMs = performance.now() - started
    const body = compressDom({ root: doc.body, atMs })

    return {
      ...recording,
      atMs,
      snapshotIndex: snapshots.indexOf(snapshot),
      snapshotCount: snapshots.length,
      elementCount: root.querySelectorAll('*').length,
      rawChars,
      result,
      elapsedMs,
      ratio: rawChars / result.charCount,
      bodyRawChars: doc.body.outerHTML.length,
      bodyResult: body,
      withinBudget: result.lineCount <= MAX_LINES && result.charCount <= MAX_CHARS,
    }
  }

  throw new Error(
    `${recording.file}: no FullSnapshot satisfies its critical state (${recording.criticalState}). ` +
      'Nothing was measured — re-record, or update the predicate to match what the recording contains.',
  )
}

const number = (value) => value.toLocaleString('en-US')
const ratio = (value) => `${value.toFixed(2)}x`

console.log('Traces — compressDom measured against the three real sample recordings')
console.log(
  `  node ${process.versions.node} · jsdom ${installedVersion('jsdom')} · ` +
    `rrweb-snapshot ${installedVersion('rrweb-snapshot')} · rrweb ${installedVersion('rrweb')}`,
)
console.log('  rebuild() into jsdom at a genuine FullSnapshot — no mutation replay, no hand-built DOM')
console.log(`  budget: <= ${MAX_LINES} lines, <= ${number(MAX_CHARS)} characters`)

const measured = RECORDINGS.map(measure)

for (const row of measured) {
  console.log('')
  console.log(`── ${row.file} ${'─'.repeat(Math.max(0, 62 - row.file.length))}`)
  console.log(`  critical state : ${row.criticalState}`)
  console.log(
    `  measured at    : ${number(row.atMs)} ms — FullSnapshot ${row.snapshotIndex + 1}/${row.snapshotCount}, ` +
      'exact, no mutations applied',
  )
  console.log(`  scope          : ${row.scope} (${row.elementCount} elements)`)
  console.log(`  raw outerHTML  : ${number(row.rawChars)} chars`)
  console.log(
    `  compressDom    : ${number(row.result.charCount)} chars, ${row.result.lineCount} lines, ` +
      `${ratio(row.ratio)}, truncated=${row.result.truncated}, ${row.elapsedMs.toFixed(1)} ms`,
  )
  console.log(
    `  60-line budget : ${row.withinBudget ? 'PASS' : 'FAIL'} ` +
      `(${row.result.lineCount}/${MAX_LINES} lines, ${row.result.charCount}/${MAX_CHARS} chars)`,
  )
  console.log(
    `  for context    : whole <body> scope is ${number(row.bodyRawChars)} chars raw → ` +
      `${number(row.bodyResult.charCount)} chars, ${row.bodyResult.lineCount} lines, ` +
      `${ratio(row.bodyRawChars / row.bodyResult.charCount)}`,
  )
  console.log('')
  for (const line of row.result.dom.split('\n')) console.log(`    │ ${line}`)
}

const columns = [
  ['recording', (row) => row.file.replace(/\.json$/, '')],
  ['at (ms)', (row) => number(row.atMs)],
  ['scope', (row) => row.scope],
  ['raw chars', (row) => number(row.rawChars)],
  ['compressed', (row) => number(row.result.charCount)],
  ['lines', (row) => String(row.result.lineCount)],
  ['ratio', (row) => ratio(row.ratio)],
  ['budget', (row) => (row.withinBudget ? 'PASS' : 'FAIL')],
]

const table = [columns.map(([heading]) => heading), ...measured.map((row) => columns.map(([, read]) => read(row)))]
const widths = columns.map((_, index) => Math.max(...table.map((cells) => cells[index].length)))
const separator = `+${widths.map((width) => '-'.repeat(width + 2)).join('+')}+`

console.log('')
console.log(separator)
for (const [index, cells] of table.entries()) {
  console.log(`| ${cells.map((cell, column) => cell.padEnd(widths[column])).join(' | ')} |`)
  if (index === 0) console.log(separator)
}
console.log(separator)

const failed = measured.filter((row) => !row.withinBudget)
if (failed.length > 0) {
  console.error('')
  console.error(
    `Budget exceeded on: ${failed.map((row) => row.file).join(', ')}. ` +
      'PRD A1 ("<= 60 lines on all three sample recordings") does not hold.',
  )
  process.exit(1)
}

console.log('')
console.log(
  'The ratio is a property of the page, not of the algorithm: this demo checkout is deliberately small ' +
    'markup,\nso the ratio is modest. A heavier page compresses further, for free, because the output ' +
    'side is capped.',
)
