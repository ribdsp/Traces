/**
 * The heading on a section of the agent column, and the reason the column has a hierarchy at all.
 *
 * Five sections stack in that column. Before this existed, every one of them opened with the same
 * `text-[11px] uppercase tracking-wide text-muted` line — dimmer than the body copy underneath it — so the
 * headings receded into their own content and the column read as one undifferentiated wall. Finding the
 * report draft meant reading four headings to rule them out.
 *
 * Three ranks, and the rank is a claim about the section, not a style choice:
 *
 *   alert  — the agent is blocked and cannot continue without a person. Only `AskHumanVisualPrompt` while a
 *            question is open, and it is the only heading allowed to take a severity colour.
 *   work   — live work that is still open: the queue, the judgements, the artefact. Brighter than the body
 *            text it introduces, which is the whole fix.
 *   record — what already happened. The activity log, and an answered question after the fact. Quiet on
 *            purpose: it is reference, and it should stop competing the moment the agent does anything else.
 *
 * Weight and colour carry the rank; the bottom margin carries proximity. `work` and `alert` bind tightly to
 * the content they head, because that content is a thing to act on and the pair should read as one block.
 * `record` gets a beat more, because underneath it is a scrolling list rather than a statement.
 *
 * `children` is everything that sits after the label — a count, an author badge, a waiting notice. Push it
 * right with `ml-auto` at the call site, the way a bare flex row already worked; the point of the shared
 * component is that the label cannot drift, not that the trailing slot is standardised into uselessness.
 *
 * `icon` is a leading glyph, and it belongs to `alert` alone. A marker on *every* heading differentiates
 * nothing — it is uniform decoration, and it would undo the hierarchy above by giving five sections a sixth
 * thing in common. On exactly one heading it is the opposite: the only section carrying a glyph is the
 * section holding the agent up, findable without reading a word. Keep it that way.
 */

type Rank = 'alert' | 'work' | 'record'

interface SectionHeadingProps {
  label: string
  rank?: Rank
  icon?: React.ReactNode
  children?: React.ReactNode
}

const TONES: Record<Rank, string> = {
  alert: 'font-medium text-warn',
  work: 'font-medium text-ink',
  record: 'text-muted',
}

const GAPS: Record<Rank, string> = {
  alert: 'mb-1.5',
  work: 'mb-1.5',
  record: 'mb-2',
}

export function SectionHeading({ label, rank = 'work', icon, children }: SectionHeadingProps) {
  return (
    <div className={`flex shrink-0 items-baseline gap-1.5 ${GAPS[rank]}`}>
      {icon}
      <h2 className={`text-[11px] uppercase tracking-wide ${TONES[rank]}`}>{label}</h2>
      {children}
    </div>
  )
}
