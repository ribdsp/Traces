import type { Recording } from '@/types/domain'

/**
 * The three sample recordings, as a static list.
 *
 * Owner: Faiq. Shared by the picker in the header and the empty state on the stage, so the names a
 * judge reads in one place are the names that load in the other.
 *
 * Why hardcoded rather than read from the directory: Traces is a static export. There is no server at
 * runtime to list `public/recordings`, and a fetch of the directory returns the host's 404 page, not a
 * listing. A three-line manifest is the honest version of that constraint.
 *
 * `id` is the file stem — `public/recordings/<id>.json` — matching `Recording.id` in the contract.
 */
export type SampleRecording = {
  id: Recording['id']
  label: Recording['label']
  /** One line, what the agent has to figure out. Shown in the picker and the empty state. */
  blurb: string
}

export const SAMPLE_RECORDINGS: readonly SampleRecording[] = [
  {
    id: 'empty-province',
    label: 'Empty province list',
    blurb: 'Submit stays disabled behind a misleading message. The province select has no options.',
  },
  {
    id: 'race-condition',
    label: 'Race condition',
    blurb: 'The dropdown renders before its data arrives, and never re-renders.',
  },
  {
    id: 'overlay-blocks-button',
    label: 'Overlay blocks the pay button',
    blurb: 'Clicks never land, because something invisible is sitting on top of the button.',
  },
]

/** Where the picker fetches a sample from. One place, so the path convention is not retyped. */
export function sampleRecordingUrl(id: string): string {
  return `/recordings/${id}.json`
}
