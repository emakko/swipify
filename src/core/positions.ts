/**
 * Indices at which to re-insert a removed song, one per original position, in the
 * order the inserts must be made. `positions` and `otherRemoved` are indices in the
 * playlist as it was when the session loaded; `otherRemoved` lists positions of other
 * songs from that session that are still removed.
 */
export function restoreIndices(positions: number[], otherRemoved: number[]): number[] {
  return [...positions]
    .sort((a, b) => a - b)
    .map((position) => position - otherRemoved.filter((removed) => removed < position).length);
}

export function clampIndex(index: number, length: number): number {
  return Math.min(Math.max(index, 0), length);
}
