/**
 * Regenerates the sample recordings in `traces/public/recordings/` by driving a real browser.
 *
 * **These are scripted fixtures, not human sessions,** and the difference is worth being precise about.
 * Everything in the resulting file is real: a real Chrome, the real bugbait build, the real
 * `rrweb.record()`, real HTTP to the real stub endpoints, real layout and real CSS. What is synthetic is
 * the *hand* — the clicks and keystrokes come from the timeline below instead of from a person. That
 * makes the fixtures reproducible to the millisecond, which is what a Gate 2 measurement needs, and it
 * is also why every file labels itself as scripted: a demo video should be recorded by a human, because
 * a human hesitates, misreads the error, and tries the wrong fix, and that is the story worth showing.
 *
 * The script clicks the same two buttons a person clicks — Start recording, then Download recording —
 * and saves the file the browser hands back. It does not build events itself. If the recorder changes,
 * these fixtures change with it, rather than drifting into a format nothing produces any more.
 *
 * Usage:
 *   npm run build && npm start          # in one terminal, serves on :3001
 *   node scripts/record-fixtures.mjs    # in another
 *
 * A production build is required, not `npm run dev`: React StrictMode double-invokes effects in
 * development, which fires the provinces request twice and re-runs the initialiser that the `race` bug
 * depends on losing. The bug would sometimes not reproduce, which is the worst possible property for a
 * fixture.
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = join(HERE, '..', '..', 'traces', 'public', 'recordings')
const BASE_URL = process.env.BUGBAIT_URL ?? 'http://localhost:3001'
const VIEWPORT = { width: 1280, height: 800 }

/** A card number from the reserved test range. Recorded masked regardless — see lib/record.ts. */
const TEST_CARD = '4000000000000002'

const BROWSER_CANDIDATES = [
  process.env.BUGBAIT_CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]

function findBrowser() {
  const found = BROWSER_CANDIDATES.find((path) => path && existsSync(path))
  if (!found) {
    throw new Error(
      'No Chrome or Edge found. Set BUGBAIT_CHROME to a Chromium-based browser executable.\nTried:\n  ' +
        BROWSER_CANDIDATES.filter(Boolean).join('\n  '),
    )
  }
  return found
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The scenarios, as timelines.
 *
 * `at` is milliseconds from the moment recording started, and the anchors are not arbitrary:
 *
 *   - the navigation into /checkout lands at 10s, so the provinces request — fired on mount, resolved
 *     1.5s later — completes at about 11.7s
 *   - the payment section is revealed at 28s, which is when `#province` first exists and, in the
 *     empty-province scenario, first has zero options
 *
 * That leaves the ~16-second gap between cause and symptom that the whole demo is about. Changing these
 * numbers changes what `bisect` is measured against, so change them deliberately.
 */
const SCENARIOS = [
  {
    bug: 'empty-province',
    file: 'empty-province.json',
    id: 'empty-province',
    label: 'Province list comes back empty (scripted fixture)',
    /**
     * The shopper does what the error message tells them to: edits the postcode, twice. The field the
     * error names is the one field that was never wrong.
     */
    async steps(page, at) {
      await at(29_000)
      await page.click('#province')
      await at(30_200)
      await page.click('#province')

      await at(31_500)
      await page.click('#card')
      await page.type('#card', TEST_CARD, { delay: 90 })

      // The blocking error is on screen from here: the card is complete, so validation stops waiting.
      await at(38_000)
      await page.click('#province')
      await at(38_700)
      await page.click('#province')
      await at(39_300)
      await page.click('#province')

      await at(41_000)
      await page.click('#postcode')
      await page.fill('#postcode', '')
      await page.type('#postcode', '40115', { delay: 110 })

      await at(45_000)
      // A real mouse event at the button's centre. `page.click` would refuse: the button is disabled,
      // and a disabled button receives no click — which is precisely what the recording should show.
      const box = await page.locator('#pay').boundingBox()
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await at(46_500)
    },
  },
  {
    bug: 'race',
    file: 'race-condition.json',
    id: 'race-condition',
    label: 'City dropdown renders before its data arrives (scripted fixture)',
    /**
     * Province works; city does not. Choosing a second province re-requests and re-succeeds, and the
     * select is still empty — which is the fact that rules out the endpoint and leaves only the client.
     */
    async steps(page, at) {
      await at(29_000)
      await page.selectOption('#province', 'JB')

      await at(31_000)
      await page.click('#city')
      await at(32_000)
      await page.click('#city')

      await at(33_000)
      await page.click('#card')
      await page.type('#card', TEST_CARD, { delay: 90 })

      await at(39_000)
      await page.selectOption('#province', 'JT')
      await at(41_000)
      await page.click('#city')
      await at(41_800)
      await page.click('#city')

      await at(43_500)
      await page.click('#postcode')
      await page.fill('#postcode', '')
      await page.type('#postcode', '50231', { delay: 110 })
      await at(46_500)
    },
  },
  {
    bug: 'overlay',
    file: 'overlay-blocks-button.json',
    id: 'overlay-blocks-button',
    label: 'Pay button is covered by a promo strip (scripted fixture)',
    /**
     * Every field is valid and `#pay` is enabled, so the clicks are dispatched at real coordinates with
     * `page.mouse` rather than through Playwright's click helper: the helper's actionability check
     * notices the overlay and refuses, which is exactly the finding the recording is supposed to contain
     * rather than something to work around. A real mouse event at the button's centre is delivered to
     * whatever is topmost there — the promo strip — which is what happens to a person's click too.
     */
    async steps(page, at) {
      await at(29_000)
      await page.selectOption('#province', 'BA')
      await at(31_000)
      await page.selectOption('#city', { index: 1 })

      await at(32_500)
      await page.click('#card')
      await page.type('#card', TEST_CARD, { delay: 90 })

      // The promo strip dropped over the button at 32s: four seconds after the section was revealed.
      const box = await page.locator('#pay').boundingBox()
      const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

      await at(38_000)
      for (const offset of [0, 600, 1200, 1800]) {
        await at(38_000 + offset)
        await page.mouse.click(centre.x, centre.y)
      }

      await at(42_500)
      await page.mouse.click(centre.x, centre.y)
      await at(44_000)
      await page.mouse.click(centre.x, centre.y)
      await at(46_500)
    },
  },
]

/** The shared opening: ten seconds in the cart, then into checkout, then fill the address. */
async function openingSteps(page, at) {
  await at(2_000)
  await page.click('#increase-cbl')
  await at(4_500)
  await page.click('#increase-mat')
  await at(6_500)
  await page.click('#decrease-cbl')

  await at(10_000)
  await page.click('#continue-to-checkout')
  await page.waitForSelector('#name')

  await at(13_000)
  await page.click('#name')
  await page.type('#name', 'Ayu Pratiwi', { delay: 95 })

  await at(17_500)
  await page.click('#address')
  await page.type('#address', 'Jalan Melati 14', { delay: 85 })

  await at(23_000)
  await page.click('#postcode')
  await page.type('#postcode', '40112', { delay: 110 })

  // The payment section, and therefore #province, does not exist before this click.
  await at(28_000)
  await page.click('#continue')
  await page.waitForSelector('#province')
}

async function recordScenario(browser, scenario) {
  const context = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: true })
  const page = await context.newPage()

  try {
    await page.goto(`${BASE_URL}/?bug=${scenario.bug}`, { waitUntil: 'load' })
    await page.waitForSelector('text=Start recording')
    await page.click('text=Start recording')

    // Every `at()` below is relative to this instant, which is also rrweb's first event.
    const startedAt = Date.now()
    const at = async (ms) => {
      const remaining = startedAt + ms - Date.now()
      if (remaining > 0) await sleep(remaining)
    }

    await openingSteps(page, at)
    await scenario.steps(page, at)

    await page.keyboard.press('Control+Shift+Period')
    await page.waitForSelector('text=Download recording')

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('text=Download recording'),
    ])

    const tempPath = await download.path()
    const raw = JSON.parse(await readFile(tempPath, 'utf8'))

    // Only `id` and `label` are rewritten, and only so the file says what it is. The events are exactly
    // what the browser produced.
    const payload = { ...raw, id: scenario.id, label: scenario.label }

    await mkdir(OUTPUT_DIR, { recursive: true })
    const target = join(OUTPUT_DIR, scenario.file)
    await writeFile(target, JSON.stringify(payload))

    const events = payload.events
    const fullSnapshots = events.filter((event) => event.type === 2).length
    const metaEvents = events.filter((event) => event.type === 4).length
    const consoleEvents = events.filter((event) => event.type === 3 && event.data?.source === 11).length
    const networkEvents = events.filter(
      (event) => event.type === 5 && event.data?.tag === 'network-request',
    ).length

    console.log(
      [
        `${scenario.file}`,
        `  duration      ${(payload.durationMs / 1000).toFixed(1)}s`,
        `  events        ${events.length}`,
        `  fullSnapshots ${fullSnapshots}`,
        `  metaEvents    ${metaEvents}`,
        `  console       ${consoleEvents}`,
        `  network       ${networkEvents}`,
      ].join('\n'),
    )
  } finally {
    await context.close()
  }
}

async function main() {
  const executablePath = findBrowser()
  console.log(`browser: ${executablePath}`)

  const response = await fetch(BASE_URL).catch(() => null)
  if (!response) {
    throw new Error(`Nothing is serving ${BASE_URL}. Run "npm run build && npm start" first.`)
  }

  const browser = await chromium.launch({ executablePath, headless: true })
  try {
    for (const scenario of SCENARIOS) {
      await recordScenario(browser, scenario)
    }
  } finally {
    await browser.close()
  }
}

await main()
