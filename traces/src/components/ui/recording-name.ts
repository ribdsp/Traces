/**
 * Turning the name of a file a person chose into the `id` and `label` a recording is loaded under.
 *
 * Pure, and in its own file, because both halves of the result travel further than a file name looks
 * like it should. `label` reaches the activity feed. `id` reaches `localStorage`, as part of the key
 * `snapshot_finding` builds — `` `traces.snapshot.${recording.id}.${slug}` `` — and reaches the model,
 * as `recordingId` in that tool's response. A file name is the one string in this app that a person
 * supplies verbatim and that nothing downstream validates again, so it is reduced to a closed
 * character set here, once, where it can be tested without a browser.
 *
 * The two halves are deliberately different shapes. A human reading the feed wants to see the file
 * they picked, punctuation and capitals included; a storage key wants `[a-z0-9-]` and nothing else.
 * Deriving both from one capped stem is what keeps them from disagreeing about which file this is.
 */

export type DerivedRecordingName = {
  /** Slug for `Recording.id`: `[a-z0-9-]`, non-empty, and safe to concatenate into a storage key. */
  id: string
  /** What a person sees. The store's `loadRecording` pushes it through `oneLine` for the feed. */
  label: string
}

/**
 * Long enough for a descriptive file name, short enough that the trigger and the feed stay one line.
 * The feed clips to 60 itself, so this cap is for the header, not for the store.
 */
const LABEL_MAX = 80

/** Used for both halves when the name survives neither pass, so neither can come back empty. */
const FALLBACK = 'recording'

/**
 * Strip the extensions this app actually produces.
 *
 * `.session.json` is checked first and not as `.json` twice: `downloadRecording` in bugbait writes
 * `<bug>.session.json`, and stripping only the last extension would leave every recorded file labelled
 * `my-bug.session`. Case-insensitive because a file input with `accept=".json"` still hands over
 * whatever the filesystem preserved, and `.JSON` is a name people have.
 */
function stripJsonSuffix(fileName: string): string {
  return fileName.replace(/\.session\.json$/i, '').replace(/\.json$/i, '')
}

/**
 * Reduce a stem to a storage-key-safe slug.
 *
 * The shape is copied from `slugify` in lib/webmcp/tools/snapshot-finding.ts rather than imported:
 * that file is a tool wrapper and this is a component helper, and a shared dependency between them
 * would tie the two areas together for four lines. Its own version also slices to a maximum, which
 * this one does not need — the stem is already capped at `LABEL_MAX`, and collapsing runs of
 * punctuation into a single `-` cannot lengthen a string.
 */
function slugify(stem: string): string {
  const slug = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug.length > 0 ? slug : FALLBACK
}

/**
 * Derive `{ id, label }` from a file name.
 *
 * The second `trim` is not redundant: capping at `LABEL_MAX` can land the cut inside a gap between
 * words and leave a trailing space that then renders as one.
 */
export function deriveRecordingName(fileName: string): DerivedRecordingName {
  const stem = stripJsonSuffix(fileName).replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX).trim()

  return {
    id: slugify(stem),
    label: stem.length > 0 ? stem : FALLBACK,
  }
}
