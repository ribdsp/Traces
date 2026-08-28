import { NextResponse } from 'next/server'
import { isBug, LATENCY_MS, SCENARIO_HEADER } from '@/lib/bugs'

/**
 * `GET /api/provinces` — the request at the centre of the primary demo bug.
 *
 * When the `empty-province` scenario is armed this returns **200 with `[]`**, and the distinction from
 * a 500 is the whole point. An error status shows up red in a network tab and the investigation takes
 * four seconds; a success that happens to be empty looks like nothing at all, and only the *shape* of
 * the body gives it away. `read_network` summarises that body as `"array, 0 items"`, which is the
 * single fact the agent has to find, roughly sixteen seconds before the page looks wrong.
 *
 * The scenario arrives in a request header, never the query string — see `SCENARIO_HEADER`. The URL is
 * recorded; the header is not.
 */

export const dynamic = 'force-dynamic'

const PROVINCES = [
  { code: 'AC', name: 'Aceh' },
  { code: 'BA', name: 'Bali' },
  { code: 'BT', name: 'Banten' },
  { code: 'JK', name: 'DKI Jakarta' },
  { code: 'JB', name: 'Jawa Barat' },
  { code: 'JT', name: 'Jawa Tengah' },
  { code: 'JI', name: 'Jawa Timur' },
  { code: 'KB', name: 'Kalimantan Barat' },
  { code: 'NB', name: 'Nusa Tenggara Barat' },
  { code: 'PB', name: 'Papua Barat' },
  { code: 'SN', name: 'Sulawesi Selatan' },
  { code: 'SU', name: 'Sumatera Utara' },
  { code: 'YO', name: 'DI Yogyakarta' },
] as const

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function GET(request: Request): Promise<NextResponse> {
  const scenario = request.headers.get(SCENARIO_HEADER)
  await delay(LATENCY_MS.provinces)

  if (isBug(scenario) && scenario === 'empty-province') {
    return NextResponse.json([])
  }

  return NextResponse.json(PROVINCES)
}
