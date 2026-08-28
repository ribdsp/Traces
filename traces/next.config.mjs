import { fileURLToPath } from 'node:url'

/**
 * The Origin Trial token has to arrive as an HTTP header, not a `<meta>` tag.
 *
 * A meta tag only enables the trial for the document itself; a header enables it for the document
 * *and* its sub-resources. Traces registers its tools from a client component that Next.js serves as
 * a separate chunk, so the meta-tag route silently gives you a page where `document.modelContext`
 * exists in the console but not in your own module. That failure looks like a bug in your code for
 * about an hour before you find it.
 *
 * The token is bound to an origin, so localhost and production need different ones. Put yours in
 * `.env.local` (see `.env.example`). With no token set, no header is sent and the polyfill in
 * `src/lib/webmcp/polyfill.ts` takes over.
 *
 * **Do not add `output: 'export'`.** Every page here is prerendered anyway — `next build` reports `/` as
 * `○ (Static)` — so a static export looks like a free simplification, and it is the one change that
 * breaks WebMCP without breaking the build: `headers()` has no meaning when there is no server to send
 * them, so the trial silently stops applying and the polyfill takes over on a host that could have run
 * the real thing. Deploy this as a normal Next.js app.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,

  /*
   * This app is its own root: `traces/` and `bugbait/` install separately and neither is a workspace
   * member. Without this, Next infers the tracing root by walking up until it stops finding lockfiles,
   * so a stray `package-lock.json` anywhere above the checkout — a home directory is the usual culprit
   * — silently moves the root there and the build traces a tree it has no business reading. Pinning it
   * makes the build depend only on what is inside this folder.
   */
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),

  async headers() {
    const token = process.env.NEXT_PUBLIC_WEBMCP_ORIGIN_TRIAL_TOKEN
    if (!token) return []

    return [
      {
        source: '/:path*',
        headers: [{ key: 'Origin-Trial', value: token }],
      },
    ]
  },
}

export default nextConfig
