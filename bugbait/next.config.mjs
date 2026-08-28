import { fileURLToPath } from 'node:url'

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

  // Same reason as in traces/next.config.mjs: this folder installs on its own, so the tracing root is
  // this folder, not whatever ancestor happens to contain a lockfile.
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
}

export default nextConfig
