/**
 * Turning a recording time into a position on the axis.
 *
 * Three components draw onto the same 96px strip — the axis itself, the event track and the bisect trace —
 * and every one of them needs the same two answers: where does this millisecond sit, and which way should
 * its label hang so it stays inside the panel. Keeping both here is what makes a tick, a marker and a probe
 * at the same instant land on the same pixel, which is the whole basis for a human checking an agent's
 * claimed timestamp against the picture.
 *
 * Percentages, never pixels: the panel is resizable and the demo gets recorded at a width nobody develops
 * at.
 */

/** Left offset for a recording time, as a CSS percentage. */
export function percentOf(atMs: number, durationMs: number): string {
  if (durationMs <= 0) return '0%'
  // Clamped rather than allowed off-axis. A timestamp past the end pins to the edge, which reads as
  // "at the end, roughly" — where the unclamped version would place it outside the panel and look absent.
  const ratio = Math.min(Math.max(atMs / durationMs, 0), 1)
  return `${ratio * 100}%`
}

/**
 * Which side of its anchor a label should hang from, as a Tailwind translate class.
 *
 * Centred in the middle of the axis, tucked in at both ends. Without this a label at 0s is half outside
 * the panel and one at the end is clipped by it — the two timestamps a human is most likely to read.
 */
export function anchorFor(atMs: number, durationMs: number): string {
  if (durationMs <= 0) return 'translate-x-0'
  const ratio = atMs / durationMs
  if (ratio < 0.04) return 'translate-x-0'
  if (ratio > 0.96) return '-translate-x-full'
  return '-translate-x-1/2'
}
