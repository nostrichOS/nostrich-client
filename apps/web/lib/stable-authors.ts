/** The author list a Following feed subscribes to, held steady while the reader. */
export function nextAuthors(
  held: readonly string[] | undefined,
  incoming: readonly string[],
  keyChanged: boolean,
): readonly string[] {
  // A move: the reader is somewhere else now and the previous list is not theirs to keep.
  if (keyChanged || held === undefined) return incoming
  // The answer arriving, rather than an edit.
  if (held.length === 0) return incoming
  return held
}
