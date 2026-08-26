/**
 * bugbait — the app whose bugs become the recordings Traces investigates.
 *
 * No Origin-Trial header here, unlike traces: bugbait exposes no tools and needs no WebMCP. It only has
 * to be a normal web app that behaves badly in specific, reproducible ways.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
}

export default nextConfig
