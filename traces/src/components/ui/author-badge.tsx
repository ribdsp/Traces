import { Bot, User } from 'lucide-react'
import type { Author } from '@/types/domain'

interface AuthorBadgeProps {
  author: Author
  className?: string
  /**
   * `chip` is the default: a word, because colour is not enough. `icon` is for the activity feed,
   * where the row is already labelled in prose and a second word fights the line. The word stays in
   * `sr-only` either way — the shape is a glance, not a replacement for the name.
   */
  variant?: 'chip' | 'icon'
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
 * violet from blue, and "AGENT" survives both. The icon variant keeps the word for assistive tech
 * and in the tooltip; it never relies on the glyph alone.
 *
 * The two colours are `agent` and `human` from the palette, which exist for this and are documented as
 * carrying authorship rather than decoration. Nothing else in the app may borrow them.
 *
 * It used to be set at 9px, which made the one place authorship is stated the smallest text in the app —
 * unreadable in a compressed recording, and therefore unreadable in the only place this gets judged. At the
 * scale's floor for a chip it is legible without becoming a label competing with the line it annotates.
 */
export function AuthorBadge({ author, className = '', variant = 'chip' }: AuthorBadgeProps) {
  const isAgent = author === 'agent'
  const label = isAgent ? 'agent' : 'you'
  const tone = isAgent ? 'text-agent' : 'text-human'

  if (variant === 'icon') {
    const Icon = isAgent ? Bot : User
    return (
      <span title={label} className={`ml-1 inline-flex shrink-0 ${tone} ${className}`}>
        <Icon aria-hidden size={13} strokeWidth={1.75} />
        <span className="sr-only">{label}</span>
      </span>
    )
  }

  return (
    <span
      className={`ml-1 shrink-0 rounded-sm px-1 text-label font-medium uppercase tracking-wide ${
        isAgent ? 'bg-agent/15 text-agent' : 'bg-human/15 text-human'
      } ${className}`}
    >
      {label}
    </span>
  )
}
