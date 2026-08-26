'use client'

import { sessionActions, useSessionStore } from '@/lib/store/session'
import { AuthorBadge } from '@/components/ui/author-badge'

/**
 * The agent's ranked explanations, waiting on a human's judgement.
 *
 * Owner: Faiq. Pairs with `propose_hypotheses`, which blocks until one is promoted or rejected.
 *
 * The tool call is suspended while these cards are on screen. That is the point of the interaction —
 * the agent has done the work it can do and is now asking a person to decide — and it means the cards
 * must always offer a way out. A card set that can be neither promoted nor rejected leaves the agent
 * hanging until its gate times out, and the demo shows a spinner.
 *
 * Each hypothesis carries evidence timestamps. Clicking one seeks there; clicking the card highlights
 * all of them at once on the timeline. Checking a claim should cost one click, because that is the
 * habit worth building in whoever is watching.
 */
export function HypothesisCards() {
  const hypotheses = useSessionStore((s) => s.hypotheses)

  if (hypotheses.length === 0) return null

  /**
   * TODO(faiq), Day 4:
   *   - render in the agent's order and label them 1..n; the ranking is part of what it said
   *   - confidence as a small bar, never a percentage badge. It is the agent's own claim, not a
   *     measurement, and a crisp "87%" reads as precision that isn't there
   *   - promote / reject per card, both calling through with author 'human'
   *   - promoted cards stay, visibly promoted. Rejected ones fade rather than vanish, so the record of
   *     what was considered survives
   *   - evidence chips seek on click
   */
  return (
    <section className="border-b border-zinc-800 p-3">
      <h2 className="mb-2 text-[11px] uppercase tracking-wide text-zinc-500">Hypotheses</h2>

      <ul className="space-y-2">
        {hypotheses.map((hypothesis, index) => (
          <li key={hypothesis.id} className="border border-zinc-800 p-2">
            <div className="flex items-baseline gap-1">
              <span className="font-mono text-[10px] text-zinc-500">{index + 1}</span>
              <p className="text-xs text-zinc-200">{hypothesis.text}</p>
              <AuthorBadge author={hypothesis.author} />
            </div>

            <div className="mt-1 flex flex-wrap gap-1">
              {hypothesis.evidence.map((item) => (
                <button
                  key={`${hypothesis.id}-${item.atMs}`}
                  type="button"
                  onClick={() => sessionActions().setCurrentTime(item.atMs, 'human')}
                  className="font-mono text-[10px] text-zinc-500 underline"
                >
                  {(item.atMs / 1000).toFixed(3)}s
                </button>
              ))}
            </div>

            <div className="mt-2 flex gap-2 text-[10px]">
              <button type="button" onClick={() => sessionActions().promoteHypothesis(hypothesis.id, 'human')}>
                promote
              </button>
              <button type="button" onClick={() => sessionActions().rejectHypothesis(hypothesis.id, 'human')}>
                reject
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
