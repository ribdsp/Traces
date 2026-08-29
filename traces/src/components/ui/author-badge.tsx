import type { Author } from '@/types/domain'

interface AuthorBadgeProps {
  author: Author
  className?: string
}

/**
 * Who did this — the smallest component in the project and one of the most load-bearing.
 *
 * The challenge asks for the agent to have an identity distinguishable from the human's. Every marker,
 * hypothesis, activity line and report shows this badge, which is why it exists as a component instead
 * of as a colour repeated in twelve places: the day someone decides agent contributions should read
 * differently, it is one file.
 *
 * Text, not just colour. This gets watched on a compressed video by people who may not distinguish
 * violet from blue, and "AGENT" survives both.
 *
 * The two colours are `agent` and `human` from the palette, which exist for this and are documented as
 * carrying authorship rather than decoration. Nothing else in the app may borrow them.
 *
 * It used to be set at 9px, which made the one place authorship is stated the smallest text in the app —
 * unreadable in a compressed recording, and therefore unreadable in the only place this gets judged. At the
 * scale's floor for a chip it is legible without becoming a label competing with the line it annotates.
 */
export function AuthorBadge({ author, className = '' }: AuthorBadgeProps) {
  const isAgent = author === 'agent'

  return (
    <span
      className={`ml-1 shrink-0 rounded-sm px-1 text-label font-medium uppercase tracking-wide ${
        isAgent ? 'bg-agent/15 text-agent' : 'bg-human/15 text-human'
      } ${className}`}
    >
      {isAgent ? 'agent' : 'you'}
    </span>
  )
}
