import type { Metadata } from 'next'
import './globals.css'
import { plexMono, plexSans } from './fonts'
import { ToolSurface } from './tool-surface'

export const metadata: Metadata = {
  title: 'Traces — agent-interrogable session replay',
  description:
    'A session replay player an AI agent can interrogate through WebMCP: bisect the timeline, read the DOM at any moment, and file a verifiable bug report.',
}

/**
 * The root layout, and the only place the tool surface is mounted.
 *
 * Registration lives in a client component rendered here rather than in `page.tsx`, so it survives
 * navigation without re-registering. One `AbortController` inside `register-tools.ts` owns the whole
 * surface; scattering registration into components is the version that leaves stale tools pointing at
 * a destroyed Replayer after a hot reload.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /*
      The font variables go on <html>, which is also where Tailwind's preflight sets the default family
      from `fontFamily.sans` — so the variable is defined on the same element that reads it. It does not
      reach the replay, which lives in its own iframe document: see the note in globals.css about why the
      recorded page must never inherit Traces's styling.
    */
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      {/*
        A flex column rather than a plain block: the tool status banner is one line when the surface is
        healthy and several when it has to explain a missing origin trial, and `page.tsx` should take
        whatever height is left rather than subtracting a number that was only ever true for one of
        those states.
      */}
      <body className="flex h-screen flex-col overflow-hidden bg-base font-sans text-ink antialiased">
        <ToolSurface />
        {children}
      </body>
    </html>
  )
}
