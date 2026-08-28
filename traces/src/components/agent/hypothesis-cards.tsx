'use client'

import { Check, X } from 'lucide-react'
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
 *
 * Not implemented, deliberately: clicking a card to highlight *all* of its evidence on the timeline at once.
 * That needs a piece of cross-component state ("which hypothesis is selected") that `SessionState` has no
 * slot for and that is frozen. Each chip seeks on its own, which costs one click per point instead of one.
 */

const TREATMENTS: Record<HypothesisStatus, { card: string; text: string; tag: string | null }> = {
  proposed: { card: 'border-line', text: 'text-ink', tag: null },
  promoted: { card: 'border-human/50 bg-human/5', text: 'text-ink', tag: 'promoted' },
  rejected: { card: 'border-panel opacity-50', text: 'text-muted line-through', tag: 'rejected' },
}

export function HypothesisCards() {
  const hypotheses = useSessionStore((s) => s.hypotheses)

  // Nothing proposed yet. A permanent empty heading in a panel that already has three of them is noise;
  // the agent's arrival is the thing that makes this section mean something.
  if (hypotheses.length === 0) return null

  const undecided = hypotheses.filter((hypothesis) => hypothesis.status === 'proposed').length

  return (
    <section className="border-b border-line p-3">
      <SectionHeading label="Hypotheses">
        {undecided > 0 ? (
          <span className="ml-auto text-right text-[10px] text-warn/80">
            {undecided === hypotheses.length
              ? 'the agent is waiting on your call'
              : `${undecided} still undecided`}
          </span>
        ) : null}
      </SectionHeading>

      <ul className="space-y-2">
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
    <li className={`border p-2 ${treatment.card}`}>
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-[10px] text-muted">{position}</span>
        <p className={`text-xs leading-relaxed ${treatment.text}`}>{hypothesis.text}</p>
        <AuthorBadge author={hypothesis.author} />
      </div>

      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="text-[9px] uppercase tracking-wide text-faint">confidence</span>
        <span
          className="h-1 w-16 bg-raised"
          title={`The agent's own confidence in this explanation, relative to the others it proposed (${confidence.toFixed(2)} of 1). Its claim, not a measurement.`}
        >
          {/*
            `agent`, not a severity: this bar is the agent's assessment of its own reasoning, which is
            exactly what that token means everywhere else. The track is a surface, so it takes `raised`.
          */}
          <span
            aria-hidden
            className="block h-1 bg-agent/70"
            style={{ width: `${confidence * 100}%` }}
          />
        </span>
        {treatment.tag ? (
          /*
            The verdict, as a glyph and a word. Both tags were `muted` and the same size, so telling a promoted
            card from a rejected one down a stack of five meant reading two words that share four letters. The
            glyph is the status; `tag` is non-null for exactly the two decided states, so the pair is complete.
          */
          <span className="ml-auto flex items-center gap-0.5 text-[9px] uppercase tracking-wide text-muted">
            {hypothesis.status === 'promoted' ? (
              <Check aria-hidden size={12} strokeWidth={1.5} />
            ) : (
              <X aria-hidden size={12} strokeWidth={1.5} />
            )}
            {treatment.tag}
          </span>
        ) : null}
      </div>

      {hypothesis.evidence.length > 0 ? (
        <ul className="mt-1.5 flex flex-wrap gap-1">
          {hypothesis.evidence.map((item, itemIndex) => (
            <li key={`${item.atMs}-${itemIndex}`}>
              <button
                type="button"
                onClick={() => sessionActions().setCurrentTime(item.atMs, 'human')}
                title={`Seek to ${item.atMs}ms — ${item.note}`}
                className="flex items-baseline gap-1 border border-line px-1 py-0.5 text-left hover:border-faint focus-visible:border-ink focus-visible:outline-none"
              >
                {/*
                  `ink`, not `human`: a seek is an affordance both parties use, and spending an authorship
                  token on one would make it decorative. The border and the mono type carry the link.
                */}
                <span className="font-mono text-[10px] text-ink">{formatSeconds(item.atMs)}</span>
                <span className="text-[10px] text-muted">{item.note}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-[10px] text-faint">
          No evidence attached — nothing on the timeline backs this one up yet.
        </p>
      )}

      <div className="mt-2 flex gap-1.5">
        <Verdict
          label="promote"
          active={hypothesis.status === 'promoted'}
          decided={decided}
          activeClass="border-human/60 text-human"
          onClick={() => sessionActions().promoteHypothesis(hypothesis.id, 'human')}
        />
        <Verdict
          label="reject"
          active={hypothesis.status === 'rejected'}
          decided={decided}
          activeClass="border-faint text-ink"
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
      className={`border px-1.5 py-0.5 text-[10px] uppercase tracking-wide focus-visible:border-ink focus-visible:outline-none ${
        active
          ? `${activeClass} cursor-default`
          : 'border-line text-muted hover:border-faint hover:text-ink'
      }`}
    >
      {label}
    </button>
  )
}
