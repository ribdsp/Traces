'use client'

import type { RegistrationResult } from '@/lib/webmcp/register-tools'

interface ToolStatusBannerProps {
  registration: RegistrationResult | null
}

/**
 * Says out loud whether the tool surface is actually live.
 *
 * Owner: Faiq.
 *
 * Without this, the failure mode is brutal: the origin trial token is missing or expired, no tool ever
 * registers, and the page looks completely fine. Someone loses an evening to that — probably during
 * judging, on a browser that isn't ours.
 *
 * So the three states are stated plainly:
 *
 *   native     — `document.modelContext` exists. The real thing. Say which browser and that it's live.
 *   polyfill   — our shim. Tools are callable from the console via `window.tracesTools`, but no agent
 *                can see them. Say that, because a demo recorded against the polyfill isn't a demo.
 *   unavailable — nothing registered. Name the likely cause (missing or expired Origin-Trial header)
 *                and link the setup steps in the README. A vague "not supported" sends people to the
 *                wrong problem.
 */
export function ToolStatusBanner({ registration }: ToolStatusBannerProps) {
  /**
   * TODO(faiq), Day 3:
   *   - three visual states, and only the healthy one is quiet. `unavailable` must be impossible to
   *     miss; `polyfill` should be visible but not alarming
   *   - show the registered tool count, which is the fastest way to spot a half-registered surface
   *   - listen for `toolchange` so dynamic registration is reflected here live — a new tool appearing
   *     mid-investigation is worth showing off
   */
  if (!registration) return null

  return (
    <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1 text-[11px] text-zinc-400">
      <span className="font-mono">{registration.mode}</span>
      <span className="text-zinc-600">{registration.registered.length} tools</span>
    </div>
  )
}
