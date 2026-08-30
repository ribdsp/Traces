'use client'

import { Check, Clock, FlaskConical, X } from 'lucide-react'
import { AuthorBadge } from '@/components/ui/author-badge'
import { formatSeconds } from '@/components/ui/format-time'
import { SectionHeading } from '@/components/ui/section-heading'
import { sessionActions, useSessionStore } from '@/lib/store/session'
import type { Hypothesis, HypothesisStatus } from '@/types/domain'

/**
 * The agent's ranked explanations, waiting on a human's judgement.
 *
 * Pairs with `propose_hypotheses`, which blocks until one is promoted or rejected.
 *
 * The tool call is suspended while these cards are on screen. That is the point of the interaction —
 * the agent has done the work it can do and is now asking a person to decide — and it means the cards
 * must always offer a way out. A card set that can be neither promoted nor rejected leaves the agent
 * hanging until its gate times out, and the demo shows a spinner.
 *
 * Each hypothesis carries evidence timestamps. Clicking one seeks there; clicking the card highlights
 * all of them at once on the timeline. Checking a claim should cost one click, because that is the
 * habit worth building in whoever is watching.
 *
 * What shipped, and why:
 *   - the agent's own order, numbered 1..n, because the ranking is part of what it said — and because the
 *     store's feed lines say "promoted hypothesis 2", which is only true if 2 is what the screen calls it
 *   - confidence as a bar. Never a percentage: the number is the agent's claim about its own reasoning, and
 *     "87%" reads as a measurement of something.
 *   - promote and reject per card, through the store with `'human'`. Whichever comes first settles the tool's
 *     gate; the opposite action stays available afterwards because a human changing their mind should be
 *     able to correct the record, and its title says the agent already has the first answer.
 *   - promoted cards stay promoted and keep the human's accent; rejected ones fade and strike through rather
 *     than vanishing, so what was considered and set aside is still readable
 *   - evidence chips seek, and carry their `note` — a bare timestamp is not evidence of anything
 *   - each card sits on its own ground rather than inside a hairline box, and the rank digit is right-aligned
 *     in a fixed column so five claims start on the same pixel. Both are the table treatment that survives
 *     this content; see below for the part that does not.
 *
 * Not a `<table>`, and that is measured rather than preferred. The columns would be rank, claim, confidence
 * and verdict; in a 380px panel the three fixed ones cost about 220px between them, which leaves the claim —
 * a sentence — roughly fifteen characters a line. A grid whose one prose column is a chimney is less legible
 * than the stack, not more, so the numeric and striping conventions carry over and the element does not.
 * `report-draft.tsx` is a real table, because its rows genuinely are short and its columns genuinely align.
 *
 * Not implemented, deliberately: clicking a card to highlight *all* of its evidence on the timeline at once.
 * That needs a piece of cross-component state ("which hypothesis is selected") that `SessionState` has no
 * slot for and that is frozen. Each chip seeks on its own, which costs one click per point instead of one.
 */

/**
 * `bg` is the card's ground. A surface rather than a border, because five hairline boxes stacked in a narrow
 * column read as a fence and the thing worth seeing is which one the human has already ruled on.
 */
const TREATMENTS: Record<
  HypothesisStatus,
  { card: string; text: string; tag: string | null; chip: string }
> = {
  proposed: { card: 'border-line bg-panel/40', text: 'text-ink', tag: null, chip: '' },
  promoted: {
    card: 'border-human/50 bg-human/5',
    text: 'text-ink',
    tag: 'promoted',
    chip: 'bg-human/15 text-human',
  },
  rejected: {
    card: 'border-line bg-panel/20 opacity-60',
    text: 'text-muted line-through',
    tag: 'rejected',
    chip: 'bg-raised text-muted',
  },
}

export function HypothesisCards() {
  const hypotheses = useSessionStore((s) => s.hypotheses)

  // Nothing proposed yet. A permanent empty heading in a panel that already has three of them is noise;
  // the agent's arrival is the thing that makes this section mean something.
  if (hypotheses.length === 0) return null

  const undecided = hypotheses.filter((hypothesis) => hypothesis.status === 'proposed').length

  return (
    <section className={`border-b p-3 ${undecided > 0 ? 'border-warn/30 bg-warn/5' : 'border-line'}`}>
      <SectionHeading label="Hypotheses" icon={FlaskConical}>
        {undecided > 0 ? (
          <span className="ml-auto flex items-center gap-1.5 rounded-sm border border-warn/30 bg-warn/10 px-1.5 py-px text-label leading-tight text-warn">
            <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-warn" />
            {undecided === hypotheses.length
              ? 'waiting on you'
              : `${undecided} still open`}
          </span>
        ) : null}
      </SectionHeading>

      <ul className="space-y-1.5">
        {hypotheses.map((hypothesis, index) => (
          <HypothesisCard key={hypothesis.id} hypothesis={hypothesis} position={index + 1} />
        ))}
      </ul>
    </section>
  )
}

function HypothesisCard({ hypothesis, position }: { hypothesis: Hypothesis; position: number }) {
  const treatment = TREATMENTS[hypothesis.status]
  const decided = hypothesis.status !== 'proposed'

  /** The agent normalises the set to sum to 1, but a bar wider than its track is a rendering bug either way. */
  const confidence = Math.min(Math.max(hypothesis.confidence, 0), 1)

  return (
    <li className={`rounded-md border p-2 ${treatment.card}`}>
      <div className="flex items-baseline gap-1.5">
        {/* Right-aligned in a fixed column: the rank is a number in a list of numbers, and 10 must not
            push the tenth claim a character further in than the first nine. */}
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-line bg-raised font-mono text-label tabular-nums text-muted">
          {position}
        </span>
        <p className={`text-body leading-relaxed ${treatment.text}`}>{hypothesis.text}</p>
        <AuthorBadge author={hypothesis.author} />
      </div>

      <div className="mt-1.5 flex items-center gap-1.5 pl-[1.125rem]">
        <span className="text-label uppercase tracking-wide text-faint">confidence</span>
        <span
          className="h-1.5 w-16 shrink-0 rounded-full bg-raised"
          title={`The agent's own confidence in this explanation, relative to the others it proposed (${confidence.toFixed(2)} of 1). Its claim, not a measurement.`}
        >
          {/*
            `agent`, not a severity: this bar is the agent's assessment of its own reasoning, which is
            exactly what that token means everywhere else. The track is a surface, so it takes `raised`.
          */}
          <span
            aria-hidden
            className="block h-1.5 rounded-full bg-agent"
            style={{ width: `${confidence * 100}%` }}
          />
        </span>
        {treatment.tag ? (
          /*
            The verdict, as a glyph and a word on its own ground. Both tags used to be `muted` at the same
            size, so telling a promoted card from a rejected one down a stack of five meant reading two words
            that share four letters. `promoted` takes `human` because a person is what promoted it — the same
            authorship claim the card's border already makes — and `rejected` stays neutral, because a set-aside
            explanation is not a failure and `error` would say it was.
          */
          <span
            className={`ml-auto flex shrink-0 items-center gap-0.5 rounded-sm px-1 text-label font-medium uppercase tracking-wide ${treatment.chip}`}
          >
            {hypothesis.status === 'promoted' ? (
              <Check aria-hidden size={12} strokeWidth={2} />
            ) : (
              <X aria-hidden size={12} strokeWidth={2} />
            )}
            {treatment.tag}
          </span>
        ) : null}
      </div>

      {hypothesis.evidence.length > 0 ? (
        <ul className="mt-1.5 flex flex-wrap gap-1 pl-[1.125rem]">
          {hypothesis.evidence.map((item, itemIndex) => (
            <li key={`${item.atMs}-${itemIndex}`}>
              {/*
                A raised chip with a lighter border, which is what everything else clickable in this app
                looks like. It used to be a hairline box on the card's own ground — indistinguishable from
                the label beside it, and the one control here whose whole purpose is to invite a click.
              */}
              <button
                type="button"
                onClick={() => sessionActions().setCurrentTime(item.atMs, 'human')}
                title={`Seek to ${item.atMs}ms — ${item.note}`}
                className="flex items-center gap-1 rounded-sm border border-line-strong bg-raised px-1 py-0.5 text-left shadow-raised hover:border-faint"
              >
                {/*
                  `ink`, not `human`: a seek is an affordance both parties use, and spending an authorship
                  token on one would make it decorative. The border and the mono type carry the link.
                */}
                <Clock aria-hidden size={11} strokeWidth={1.75} className="shrink-0 self-center text-faint" />
                <span className="font-mono text-label tabular-nums text-ink">
                  {formatSeconds(item.atMs)}
                </span>
                <span className="text-label text-muted">{item.note}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 pl-[1.125rem] text-label text-faint">
          No evidence attached — nothing on the timeline backs this one up yet.
        </p>
      )}

      <div className="mt-2 flex gap-1.5 pl-[1.125rem]">
        <Verdict
          label="promote"
          active={hypothesis.status === 'promoted'}
          decided={decided}
          activeClass="border-human/60 bg-human/10 text-human"
          onClick={() => sessionActions().promoteHypothesis(hypothesis.id, 'human')}
        />
        <Verdict
          label="reject"
          active={hypothesis.status === 'rejected'}
          decided={decided}
          activeClass="border-faint bg-raised text-ink"
          onClick={() => sessionActions().rejectHypothesis(hypothesis.id, 'human')}
        />
      </div>
    </li>
  )
}

function Verdict({
  label,
  active,
  decided,
  activeClass,
  onClick,
}: {
  label: string
  active: boolean
  decided: boolean
  activeClass: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={active}
      title={
        active
          ? `Already ${label}d.`
          : decided
            ? `Change the record to ${label}d. The agent already has your first answer — this does not ask it again.`
            : `Mark this ${label}d. This is what the agent's call is waiting for.`
      }
      className={`inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-label font-medium uppercase tracking-wide ${
        active
          ? `${activeClass} cursor-default`
          : 'border-line-strong bg-raised text-muted shadow-raised hover:border-faint hover:text-ink'
      }`}
    >
      {label === 'promote' ? (
        <Check aria-hidden size={11} strokeWidth={2} />
      ) : (
        <X aria-hidden size={11} strokeWidth={2} />
      )}
      {label}
    </button>
  )
}
