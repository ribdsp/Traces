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
 * amber from blue, and "AGENT" survives both.
 */
export function AuthorBadge({ author, className = '' }: AuthorBadgeProps) {
  const isAgent = author === 'agent'

  return (
    <span
      className={`ml-1 px-1 text-[9px] uppercase tracking-wide ${
        isAgent ? 'bg-amber-400/15 text-amber-300' : 'bg-sky-400/15 text-sky-300'
      } ${className}`}
    >
      {isAgent ? 'agent' : 'you'}
    </span>
  )
}
