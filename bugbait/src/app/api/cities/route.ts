import { NextResponse } from 'next/server'
import { LATENCY_MS } from '@/lib/bugs'

/**
 * `GET /api/cities` — always succeeds, always returns cities.
 *
 * Owner: Vicko.
 *
 * There is no scenario branch here, and that is the interesting part. In the `race` scenario this
 * endpoint behaves perfectly: 200, a full list, in under a second. The bug is entirely on the client,
 * which reads the list once during its first render — before this response exists — and never looks
 * again. So the evidence is an *ordering*, not a failure: the select was in the DOM at 31.2s, the data
 * it needed arrived at 32.1s, and nothing in the final DOM records that those two facts happened in
 * that order.
 *
 * The latency is short enough that a human never notices it and long enough that the first render
 * always loses the race. Both properties are required for the fixture to be reproducible.
 */

export const dynamic = 'force-dynamic'

const CITIES: Readonly<Record<string, readonly string[]>> = {
  BA: ['Denpasar', 'Gianyar', 'Singaraja', 'Tabanan', 'Ubud'],
  JK: ['Jakarta Barat', 'Jakarta Pusat', 'Jakarta Selatan', 'Jakarta Timur', 'Jakarta Utara'],
  JB: ['Bandung', 'Bekasi', 'Bogor', 'Cimahi', 'Depok', 'Tasikmalaya'],
  JT: ['Magelang', 'Pekalongan', 'Salatiga', 'Semarang', 'Solo'],
  JI: ['Malang', 'Kediri', 'Sidoarjo', 'Surabaya'],
  YO: ['Bantul', 'Sleman', 'Wates', 'Yogyakarta'],
}

const DEFAULT_CITIES = ['Kota Administratif', 'Kabupaten Pusat'] as const

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function GET(request: Request): Promise<NextResponse> {
  const province = new URL(request.url).searchParams.get('province') ?? ''
  await delay(LATENCY_MS.cities)

  const cities = CITIES[province] ?? DEFAULT_CITIES
  return NextResponse.json(cities.map((name, index) => ({ id: `${province}-${index}`, name })))
}
