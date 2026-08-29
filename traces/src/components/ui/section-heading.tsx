import type { LucideIcon } from 'lucide-react'

/**
 * The heading on a section of the agent column, and the reason the column has a hierarchy at all.
 *
 * Five sections stack in that column. Before this existed, every one of them opened with the same
 * dim `uppercase tracking-wide text-muted` line — dimmer than the body copy underneath it — so the
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
 * `icon` is a leading glyph, and **every section now carries one**. This replaces an earlier argument that
 * a marker belonged to `alert` alone — that a glyph on all five would be uniform decoration. It would have
 * been, if all five were the same glyph. They are not: the queue, the hypotheses, the draft and the log each
 * get a distinct shape, which is what a five-item column is scanned by when it is 380px wide and being
 * watched on video. Passing five *identical* markers would still be the mistake the old note described.
 *
 * The shape says which section; the *tint* says the rank, and that split is what keeps the palette honest.
 * Tinting each glyph "by meaning" per section would need five hues, and this app has exactly two colour
 * vocabularies — severity (`ok`/`warn`/`error`) and authorship (`human`/`agent`) — neither of which a
 * section heading is entitled to spend. So `alert` keeps `warn` as the one severity-coloured heading in the
 * column, and `work` and `record` take neutral tints that already mean "open" and "past" here.
 *
 * The prop takes the icon *component*, not rendered JSX, so size, stroke and tint are decided once here
 * instead of five times at five call sites that would drift apart by the second one.
 */

type Rank = 'alert' | 'work' | 'record'

interface SectionHeadingProps {
  label: string
  rank?: Rank
  icon?: LucideIcon
  children?: React.ReactNode
}

const TONES: Record<Rank, string> = {
  alert: 'font-medium text-warn',
  work: 'font-medium text-ink',
  record: 'text-muted',
}

/** Never brighter than the label it leads: the glyph is for finding the section, not for reading it. */
const ICON_TONES: Record<Rank, string> = {
  alert: 'text-warn',
  work: 'text-muted',
  record: 'text-faint',
}

const GAPS: Record<Rank, string> = {
  alert: 'mb-1.5',
  work: 'mb-1.5',
  record: 'mb-2',
}

export function SectionHeading({ label, rank = 'work', icon: Icon, children }: SectionHeadingProps) {
  return (
    <div className={`flex shrink-0 items-baseline gap-1.5 ${GAPS[rank]}`}>
      {/*
        `self-center` against a baseline row: a glyph has no baseline of its own, and aligning its box to
        the text's would hang it below the cap height of the word beside it. 15px matches the wordmark's
        token — the smallest size at which these shapes are still distinguishable from each other after
        video compression, which is the only reason any of them is here.
      */}
      {Icon ? (
        <Icon
          aria-hidden
          size={15}
          strokeWidth={1.75}
          className={`shrink-0 self-center ${ICON_TONES[rank]}`}
        />
      ) : null}
      <h2 className={`text-meta uppercase tracking-wide ${TONES[rank]}`}>{label}</h2>
      {children}
    </div>
  )
}
