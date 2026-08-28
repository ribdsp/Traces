'use client'

import { useEffect, useState } from 'react'
import { registerTools, unregisterTools, type RegistrationResult } from '@/lib/webmcp/register-tools'
import { ToolStatusBanner } from '@/components/ui/tool-status-banner'

/**
 * Registers every tool exactly once, and reports whether it worked.
 *
 * The cleanup is what makes this safe, and it is not optional. React 19 in development mounts effects
 * twice — mount, unmount, mount — so without `unregisterTools()` on the way out you get a duplicate
 * surface where every call is ambiguous. Aborting on cleanup makes the double pass a no-op, and gives
 * hot reload the same guarantee for free.
 *
 * Registering in a module-level side effect instead would avoid the question entirely and break
 * differently: it runs during SSR, where `document` does not exist.
 *
 * Failure is loud on purpose. If the origin trial token is missing, `registerTools` returns
 * `unavailable` and the banner says so, because the alternative is a page that looks perfect and does
 * nothing — a bug that is invisible until someone else opens it.
 */
export function ToolSurface() {
  const [registration, setRegistration] = useState<RegistrationResult | null>(null)

  useEffect(() => {
    let result: RegistrationResult
    try {
      result = registerTools()
    } catch (error: unknown) {
      // If registration throws, the app still loads and says why it can't.
      const message = error instanceof Error ? error.message : 'registration failed'
      result = { mode: 'unavailable', registered: [] }
      // eslint-disable-next-line no-console -- the only diagnostic path before the banner is real
      console.warn(`[traces] tool registration unavailable: ${message}`)
    }

    setRegistration(result)
    return () => unregisterTools()
  }, [])

  return <ToolStatusBanner registration={registration} />
}
