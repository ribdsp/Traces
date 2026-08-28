'use client'

import { useEffect, useState } from 'react'
import { registerTools, unregisterTools, type RegistrationResult } from '@/lib/webmcp/register-tools'
import { ToolStatusBanner } from '@/components/ui/tool-status-banner'
import { WebMcpBadge } from '@/components/ui/webmcp-badge'

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
 *
 * Both consumers of `registration` live here, and they are not redundant. `ToolStatusBanner` is in flow
 * and always visible: it is the health signal, and it is what the paragraph above is about.
 * `WebMcpBadge` is a docked overlay that explains what WebMCP is and lists what this page exposes — the
 * thing a judge opens once. Neither can be folded into the other without one of the two jobs losing.
 */
export function ToolSurface() {
  const [registration, setRegistration] = useState<RegistrationResult | null>(null)

  useEffect(() => {
    /*
     * `registerTools` is async because the spec's `registerTool` rejects rather than throws. The flag
     * is what keeps React 19's double mount honest: the first pass is aborted on cleanup and resolves
     * with nothing registered, and without this guard that empty result can land after the second
     * pass's real one and grey out a banner over sixteen live tools.
     */
    let active = true

    void registerTools().then(
      (result) => {
        if (active) setRegistration(result)
      },
      (error: unknown) => {
        // If registration rejects, the app still loads and says why it can't.
        const message = error instanceof Error ? error.message : 'registration failed'
        // eslint-disable-next-line no-console -- the only diagnostic path before the banner is real
        console.warn(`[traces] tool registration unavailable: ${message}`)
        if (active) setRegistration({ mode: 'unavailable', registered: [] })
      },
    )

    return () => {
      active = false
      unregisterTools()
    }
  }, [])

  return (
    <>
      <ToolStatusBanner registration={registration} />
      <WebMcpBadge registration={registration} />
    </>
  )
}
