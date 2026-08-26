import type { Config } from 'tailwindcss'

/**
 * bugbait's styling exists to make the app look like an ordinary checkout.
 *
 * Not a design exercise: the point is that a viewer recognises it as a normal shop instantly and pays
 * attention to the bug rather than to the interface. Defaults are exactly right for that.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
}

export default config
