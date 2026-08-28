'use client'

import { AuthorBadge } from '@/components/ui/author-badge'
import { formatSeconds } from '@/components/ui/format-time'
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
  proposed: { card: 'border-zinc-800', text: 'text-zinc-200', tag: null },
  promoted: { card: 'border-sky-500/50 bg-sky-500/5', text: 'text-zinc-100', tag: 'promoted' },
  rejected: { card: 'border-zinc-900 opacity-50', text: 'text-zinc-400 line-through', tag: 'rejected' },
}

export function HypothesisCards() {
  const hypotheses = useSessionStore((s) => s.hypotheses)

  // Nothing proposed yet. A permanent empty heading in a panel that already has three of them is noise;
  // the agent's arrival is the thing that makes this section mean something.
  if (hypotheses.length === 0) return null

  const undecided = hypotheses.filter((hypothesis) => hypothesis.status === 'proposed').length

  return (
    <section className="border-b border-zinc-800 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-[11px] uppercase tracking-wide text-zinc-500">Hypotheses</h2>
        {undecided > 0 ? (
          <span className="text-[10px] text-amber-300/80">
            {undecided === hypotheses.length
              ? 'the agent is waiting on your call'
              : `${undecided} still undecided`}
          </span>
        ) : null}
      </div>

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
        <span className="font-mono text-[10px] text-zinc-500">{position}</span>
        <p className={`text-xs leading-relaxed ${treatment.text}`}>{hypothesis.text}</p>
        <AuthorBadge author={hypothesis.author} />
      </div>

      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="text-[9px] uppercase tracking-wide text-zinc-600">confidence</span>
        <span
          className="h-1 w-16 bg-zinc-800"
          title={`The agent's own confidence in this explanation, relative to the others it proposed (${confidence.toFixed(2)} of 1). Its claim, not a measurement.`}
        >
          <span
            aria-hidden
            className="block h-1 bg-amber-400/70"
            style={{ width: `${confidence * 100}%` }}
          />
        </span>
        {treatment.tag ? (
          <span className="ml-auto text-[9px] uppercase tracking-wide text-zinc-500">
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
                className="flex items-baseline gap-1 border border-zinc-800 px-1 py-0.5 text-left hover:border-zinc-600"
              >
                <span className="font-mono text-[10px] text-sky-300">{formatSeconds(item.atMs)}</span>
                <span className="text-[10px] text-zinc-400">{item.note}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-[10px] text-zinc-600">
          No evidence attached — nothing on the timeline backs this one up yet.
        </p>
      )}

      <div className="mt-2 flex gap-1.5">
        <Verdict
          label="promote"
          active={hypothesis.status === 'promoted'}
          decided={decided}
          activeClass="border-sky-500/60 text-sky-200"
          onClick={() => sessionActions().promoteHypothesis(hypothesis.id, 'human')}
        />
        <Verdict
          label="reject"
          active={hypothesis.status === 'rejected'}
          decided={decided}
          activeClass="border-zinc-600 text-zinc-300"
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
      className={`border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
        active
          ? `${activeClass} cursor-default`
          : 'border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-200'
      }`}
    >
      {label}
    </button>
  )
}
