import type { Metadata } from 'next'
import './globals.css'
import { ToolSurface } from './tool-surface'

export const metadata: Metadata = {
  title: 'Traces — agent-interrogable session replay',
  description:
    'A session replay player an AI agent can interrogate through WebMCP: bisect the timeline, read the DOM at any moment, and file a verifiable bug report.',
}

/**
 * The root layout, and the only place the tool surface is mounted.
 *
 * Owner: Faiq (shell), Vicko (registration).
 *
 * Registration lives in a client component rendered here rather than in `page.tsx`, so it survives
 * navigation without re-registering. One `AbortController` inside `register-tools.ts` owns the whole
 * surface; scattering registration into components is the version that leaves stale tools pointing at
 * a destroyed Replayer after a hot reload.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="h-screen overflow-hidden bg-zinc-950 text-zinc-200 antialiased">
        <ToolSurface />
        {children}
      </body>
    </html>
  )
}
