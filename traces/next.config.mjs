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
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,

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
