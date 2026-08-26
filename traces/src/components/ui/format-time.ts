/**
 * How a recording time is written on the timeline — ticks, marker labels, bisect probes.
 *
 * Owner: Faiq.
 *
 * One decimal, always, and always seconds. The reason it is a shared function rather than a `.toFixed`
 * at each call site: a human's most common act in this app is checking an agent's claimed timestamp
 * against the timeline, and that comparison is meaningless if the marker says `28.4s` and the tick above
 * it says `28412ms`. Same precision in both places, or the check silently stops working.
 *
 * The player's clock is deliberately not this. It reads at millisecond precision because it is an
 * instrument, not a label, and rounding it would hide exactly the drift someone is watching for.
 *
 * Recording-relative ms in, per the contract — never an epoch value.
 */
export function formatSeconds(atMs: number): string {
  return `${(atMs / 1000).toFixed(1)}s`
}
